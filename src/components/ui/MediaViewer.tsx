import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    ChevronLeft,
    ChevronRight,
    Download,
    Play,
    Image as ImageIcon,
    FolderOpen,
    MapPin,
    Calendar,
    User,
    AlertCircle,
    Volume2,
    Loader2
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { cn, safeConvertFileSrc } from '../../lib/utils';
import { MediaViewerItem } from '../../types';

interface MediaViewerProps {
    isOpen: boolean;
    onClose: () => void;
    items: MediaViewerItem[];
    currentIndex: number;
    onIndexChange?: (index: number) => void;
    addToast?: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

function getFileExtension(pathOrUrl: string, mediaType?: string, eventType?: string): string {
    const clean = pathOrUrl.split('?')[0].split('#')[0];
    const match = clean.match(/\.([a-zA-Z0-9]+)$/);
    if (match) return match[1].toLowerCase();
    if (mediaType?.toLowerCase() === 'video' || eventType === 'SNAP_VIDEO') return 'mp4';
    if (mediaType?.toLowerCase() === 'audio' || eventType === 'NOTE') return 'm4a';
    return 'jpg';
}

function formatTimestampForFilename(timestamp?: string): string {
    if (!timestamp) return 'media';
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return 'media';
        const YYYY = d.getFullYear();
        const MM = String(d.getMonth() + 1).padStart(2, '0');
        const DD = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${YYYY}-${MM}-${DD}_${hh}${mm}${ss}`;
    } catch {
        return 'media';
    }
}

export const MediaViewer: React.FC<MediaViewerProps> = ({
    isOpen,
    onClose,
    items,
    currentIndex,
    onIndexChange,
    addToast
}) => {
    const currentItem = items[currentIndex];
    const [showUI, setShowUI] = useState(true);
    const [saving, setSaving] = useState(false);
    const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isHoveringControlsRef = useRef(false);
    const hasPushedStateRef = useRef(false);

    // Reset auto-hide timer on user interaction
    const resetHideTimer = useCallback(() => {
        setShowUI(true);
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        if (!isHoveringControlsRef.current) {
            hideTimeoutRef.current = setTimeout(() => {
                setShowUI(false);
            }, 3500);
        }
    }, []);

    // Pause timer when hovering interactive controls
    const handleControlMouseEnter = () => {
        isHoveringControlsRef.current = true;
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        setShowUI(true);
    };

    const handleControlMouseLeave = () => {
        isHoveringControlsRef.current = false;
        resetHideTimer();
    };

    // Browser history integration for Back button
    useEffect(() => {
        if (!isOpen) {
            hasPushedStateRef.current = false;
            return;
        }

        // Push state for this modal
        window.history.pushState({ modal: 'mediaViewer' }, '');
        hasPushedStateRef.current = true;

        const handlePopState = () => {
            if (hasPushedStateRef.current) {
                hasPushedStateRef.current = false;
                onClose();
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [isOpen, onClose]);

    const handleClose = useCallback(() => {
        if (hasPushedStateRef.current) {
            hasPushedStateRef.current = false;
            window.history.back();
        } else {
            onClose();
        }
    }, [onClose]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;
        resetHideTimer();

        const handleKeyDown = (e: KeyboardEvent) => {
            resetHideTimer();
            if (e.key === 'Escape') handleClose();
            if (e.key === 'ArrowLeft') handlePrev();
            if (e.key === 'ArrowRight') handleNext();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
    }, [isOpen, currentIndex, items.length, handleClose, resetHideTimer]);

    if (!isOpen || !currentItem) return null;

    const handleNext = () => {
        if (currentIndex < items.length - 1) {
            onIndexChange?.(currentIndex + 1);
        }
    };

    const handlePrev = () => {
        if (currentIndex > 0) {
            onIndexChange?.(currentIndex - 1);
        }
    };

    const getMediaSrc = (item: MediaViewerItem) => {
        const path = item.media_path || item.path || (item.media_references?.[0]);
        if (path) return safeConvertFileSrc(path);
        return null;
    };

    const getMediaType = (item: MediaViewerItem) => {
        const path = item.media_path || item.path || (item.media_references?.[0]) || '';
        const clean = path.split('?')[0].toLowerCase();
        if (clean.endsWith('.m4a') || clean.endsWith('.aac') || clean.endsWith('.opus') || clean.endsWith('.mp3') || item.event_type === 'NOTE') {
            return 'Audio';
        }
        if (clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.webm') || item.event_type === 'SNAP_VIDEO') {
            return 'Video';
        }
        const type = item.media_type || 'Image';
        return type;
    };

    const src = getMediaSrc(currentItem);
    const mediaType = getMediaType(currentItem).toLowerCase();
    const isVideo = mediaType === 'video';
    const isAudio = mediaType === 'audio';

    const openInFinder = async () => {
        const path = currentItem.media_path || currentItem.path || currentItem.media_references?.[0];
        if (path) {
            try {
                await invoke('show_in_folder', { path });
            } catch (err: any) {
                addToast?.('error', `Failed to open folder: ${err}`);
            }
        }
    };

    const handleDownload = async () => {
        if (saving || !currentItem) return;
        try {
            setSaving(true);
            const sourcePath = currentItem.media_path || currentItem.path || (currentItem.media_references?.[0]);

            if (!sourcePath) {
                addToast?.('error', 'No local media file available to save.');
                return;
            }

            const ext = getFileExtension(sourcePath, currentItem.media_type, currentItem.event_type);
            const dateStr = formatTimestampForFilename(currentItem.timestamp);
            const senderStr = (currentItem.sender_name || currentItem.sender || '')
                .replace(/[^a-zA-Z0-9_-]/g, '_')
                .slice(0, 20);
            const defaultName = senderStr
                ? `Snap_${dateStr}_${senderStr}.${ext}`
                : `Snap_${dateStr}.${ext}`;

            const filterLabel = isVideo ? 'Video' : isAudio ? 'Audio' : 'Image';
            const destinationPath = await save({
                defaultPath: defaultName,
                filters: [{ name: filterLabel, extensions: [ext] }]
            });

            if (!destinationPath) {
                return; // User cancelled
            }

            addToast?.('info', 'Saving file...');
            await invoke('export_media_file', {
                sourcePath,
                destinationPath,
                timestamp: currentItem.timestamp || null,
            });

            const savedName = destinationPath.split(/[\\/]/).pop() || destinationPath;
            addToast?.('success', `Saved to ${savedName}`);
        } catch (err: any) {
            console.error('Download error:', err);
            addToast?.('error', `Failed to save: ${err?.message || err}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-100 bg-surface-50/98 dark:bg-surface-950/98 backdrop-blur-2xl flex flex-col items-center justify-center overflow-hidden select-none"
                onMouseMove={resetHideTimer}
                onTouchStart={resetHideTimer}
            >
                {/* Background Ambient Glow */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-purple-500/10 dark:bg-purple-600/20 rounded-full blur-[160px]" />
                </div>

                {/* Top bar */}
                <motion.div
                    animate={{ y: showUI ? 0 : -80, opacity: showUI ? 1 : 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute top-0 left-0 right-0 px-6 py-4 flex justify-between items-center bg-white/95 dark:bg-surface-950/90 backdrop-blur-xl border-b border-surface-200/80 dark:border-white/10 z-30 shadow-xs"
                    onMouseEnter={handleControlMouseEnter}
                    onMouseLeave={handleControlMouseLeave}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleClose}
                            className="p-2.5 rounded-full bg-surface-100 hover:bg-surface-200 text-surface-700 hover:text-surface-900 border border-surface-200 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white dark:border-white/10 transition-colors cursor-pointer active:scale-95 shadow-xs"
                            title="Close (Esc)"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        <div className="flex flex-col">
                            <span className="text-surface-900 dark:text-white font-bold text-sm flex items-center gap-2">
                                {isVideo ? (
                                    <Play className="w-4 h-4 fill-brand-500 text-brand-500" />
                                ) : isAudio ? (
                                    <Volume2 className="w-4 h-4 text-accent-cyan" />
                                ) : (
                                    <ImageIcon className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                )}
                                {items.length > 1 ? `Media ${currentIndex + 1} of ${items.length}` : 'Media Viewer'}
                            </span>
                            {currentItem.timestamp && (
                                <span className="text-surface-500 dark:text-surface-400 text-xs flex items-center gap-1.5 mt-0.5 font-medium">
                                    <Calendar className="w-3 h-3 text-surface-400 dark:text-surface-500" />
                                    {new Date(currentItem.timestamp).toLocaleString(undefined, {
                                        dateStyle: 'medium',
                                        timeStyle: 'short'
                                    })}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {(currentItem.media_path || currentItem.path || currentItem.media_references?.[0]) && (
                            <button
                                onClick={openInFinder}
                                className="px-3.5 py-2 rounded-xl bg-surface-100 hover:bg-surface-200 text-surface-800 border border-surface-200 dark:bg-white/10 dark:hover:bg-white/20 dark:text-white/90 dark:border-white/15 transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer active:scale-95 shadow-xs"
                                title="Reveal in File Explorer"
                            >
                                <FolderOpen className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                                <span>Show in Folder</span>
                            </button>
                        )}
                        <button
                            onClick={handleDownload}
                            disabled={saving}
                            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 border border-purple-500/30 text-white font-bold transition-all flex items-center gap-2 text-xs shadow-md shadow-purple-600/25 active:scale-95 cursor-pointer disabled:opacity-50"
                            title="Save As with formatted filename and metadata"
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Saving...</span>
                                </>
                            ) : (
                                <>
                                    <Download className="w-4 h-4" />
                                    <span>Save As...</span>
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>

                {/* Main content display */}
                <div className="relative w-full h-full flex items-center justify-center p-6">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentIndex}
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.2 }}
                            className="max-w-full max-h-full flex items-center justify-center z-10"
                        >
                            {src ? (
                                isVideo ? (
                                    <video
                                        src={src}
                                        controls
                                        autoPlay
                                        className="max-w-[92vw] max-h-[82vh] rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/80 border border-surface-200/80 dark:border-white/10 bg-black"
                                    />
                                ) : isAudio ? (
                                    <div className="p-8 rounded-3xl bg-white dark:bg-surface-900/90 border border-surface-200 dark:border-white/10 shadow-2xl flex flex-col items-center gap-6 max-w-md w-full backdrop-blur-xl">
                                        <div className="w-24 h-24 rounded-2xl bg-linear-to-br from-brand-500 to-accent-cyan flex items-center justify-center shadow-xl shadow-brand-500/20">
                                            <Volume2 className="w-12 h-12 text-white" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-surface-900 dark:text-white font-bold text-base">Audio Note</p>
                                            {currentItem.sender && (
                                                <p className="text-surface-500 dark:text-surface-400 text-xs mt-1">From {currentItem.sender_name || currentItem.sender}</p>
                                            )}
                                        </div>
                                        <audio src={src} controls autoPlay className="w-full" />
                                    </div>
                                ) : (
                                    <img
                                        src={src}
                                        alt="Media preview"
                                        className="max-w-[92vw] max-h-[82vh] rounded-2xl shadow-2xl shadow-surface-900/10 dark:shadow-black/80 border border-surface-200/80 dark:border-white/10 object-contain bg-white dark:bg-black/40"
                                        draggable={false}
                                    />
                                )
                            ) : (
                                <div className="text-surface-400 dark:text-white/30 flex flex-col items-center gap-4 p-8 bg-white dark:bg-white/5 rounded-3xl border border-surface-200 dark:border-white/10 shadow-lg">
                                    <AlertCircle className="w-16 h-16 text-amber-500" />
                                    <p className="text-sm font-semibold text-surface-700 dark:text-white/70">Media file not available locally</p>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>

                    {/* Navigation Buttons */}
                    {items.length > 1 && (
                        <>
                            <motion.button
                                animate={{
                                    opacity: showUI ? (currentIndex === 0 ? 0.2 : 0.95) : 0,
                                    x: showUI ? 0 : -20
                                }}
                                whileHover={{ opacity: currentIndex === 0 ? 0.2 : 1, scale: currentIndex === 0 ? 1 : 1.08 }}
                                whileTap={{ scale: 0.95 }}
                                className={cn(
                                    "absolute left-6 top-1/2 -translate-y-1/2 p-3.5 rounded-full bg-white hover:bg-surface-50 text-surface-800 hover:text-surface-950 border border-surface-200/90 shadow-xl dark:bg-black/60 dark:hover:bg-black/90 dark:text-white dark:border-white/20 backdrop-blur-xl transition-all z-30 cursor-pointer active:scale-95",
                                    currentIndex === 0 && "cursor-not-allowed opacity-20"
                                )}
                                onMouseEnter={handleControlMouseEnter}
                                onMouseLeave={handleControlMouseLeave}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handlePrev();
                                }}
                                disabled={currentIndex === 0}
                                title="Previous media (Left arrow)"
                            >
                                <ChevronLeft className="w-7 h-7" />
                            </motion.button>
                            <motion.button
                                animate={{
                                    opacity: showUI ? (currentIndex === items.length - 1 ? 0.2 : 0.95) : 0,
                                    x: showUI ? 0 : 20
                                }}
                                whileHover={{ opacity: currentIndex === items.length - 1 ? 0.2 : 1, scale: currentIndex === items.length - 1 ? 1 : 1.08 }}
                                whileTap={{ scale: 0.95 }}
                                className={cn(
                                    "absolute right-6 top-1/2 -translate-y-1/2 p-3.5 rounded-full bg-white hover:bg-surface-50 text-surface-800 hover:text-surface-950 border border-surface-200/90 shadow-xl dark:bg-black/60 dark:hover:bg-black/90 dark:text-white dark:border-white/20 backdrop-blur-xl transition-all z-30 cursor-pointer active:scale-95",
                                    currentIndex === items.length - 1 && "cursor-not-allowed opacity-20"
                                )}
                                onMouseEnter={handleControlMouseEnter}
                                onMouseLeave={handleControlMouseLeave}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleNext();
                                }}
                                disabled={currentIndex === items.length - 1}
                                title="Next media (Right arrow)"
                            >
                                <ChevronRight className="w-7 h-7" />
                            </motion.button>
                        </>
                    )}
                </div>

                {/* Bottom info panel */}
                <motion.div
                    animate={{ y: showUI ? 0 : 60, opacity: showUI ? 1 : 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl bg-white/95 dark:bg-surface-950/85 border border-surface-200 dark:border-white/15 backdrop-blur-2xl flex items-center gap-6 z-30 shadow-xl text-surface-800 dark:text-white/90"
                    onMouseEnter={handleControlMouseEnter}
                    onMouseLeave={handleControlMouseLeave}
                    onClick={(e) => e.stopPropagation()}
                >
                    {currentItem.sender && (
                        <div className="flex items-center gap-2 text-surface-800 dark:text-white/90 text-xs font-semibold">
                            <User className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                            <span>{currentItem.sender_name || currentItem.sender}</span>
                        </div>
                    )}
                    {currentItem.media_type && (
                        <div className="flex items-center gap-2 text-surface-600 dark:text-white/70 text-xs font-medium">
                            <ImageIcon className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                            <span>{currentItem.media_type}</span>
                        </div>
                    )}
                    {currentItem.latitude && currentItem.longitude && (
                        <div className="flex items-center gap-2 text-surface-600 dark:text-white/70 text-xs font-medium">
                            <MapPin className="w-3.5 h-3.5 text-accent-cyan" />
                            <span>{`${currentItem.latitude.toFixed(4)}, ${currentItem.longitude.toFixed(4)}`}</span>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
