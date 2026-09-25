import React, { useState, useEffect, useMemo } from 'react';
import {
    Image as ImageIcon,
    Video,
    Volume2,
    Sparkles,
    Send,
    Inbox,
    ArrowLeft,
    Calendar,
    Search,
    MessageSquare,
    Loader2
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '../lib/utils';
import { Event, MediaViewerItem } from '../types';
import { MediaThumbnail } from './ui/MediaThumbnail';
import { MediaViewer } from './ui/MediaViewer';

interface ConversationMediaGalleryProps {
    conversationId: string;
    conversationName: string;
    onClose: () => void;
    onJumpToMessage: (messageId: string) => void;
    addToast: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

interface GalleryMediaEntry extends MediaViewerItem {
    eventId: string;
    isSender: boolean;
    dateMonth: string; // "YYYY-MM"
}

export const ConversationMediaGallery: React.FC<ConversationMediaGalleryProps> = ({
    conversationId,
    conversationName,
    onClose,
    onJumpToMessage,
    addToast
}) => {
    const [events, setEvents] = useState<Event[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [typeFilter, setTypeFilter] = useState<'ALL' | 'SNAPS' | 'PHOTOS' | 'VIDEOS' | 'AUDIO'>('ALL');
    const [directionFilter, setDirectionFilter] = useState<'ALL' | 'SENT' | 'RECEIVED'>('ALL');
    const [monthFilter, setMonthFilter] = useState<string>('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Media Viewer state
    const [viewerIndex, setViewerIndex] = useState(-1);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        invoke<Event[]>('get_conversation_media', { conversationId })
            .then((data) => {
                if (mounted) {
                    setEvents(data);
                    setLoading(false);
                }
            })
            .catch((err) => {
                console.error('Failed to load conversation media:', err);
                if (mounted) {
                    addToast('error', 'Failed to load conversation media');
                    setLoading(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, [conversationId, addToast]);

    // Flatten events to individual media entries
    const allMediaItems = useMemo<GalleryMediaEntry[]>(() => {
        const list: GalleryMediaEntry[] = [];
        for (const ev of events) {
            let isSender = false;
            if (ev.metadata) {
                try {
                    const parsed = JSON.parse(ev.metadata);
                    isSender = Boolean(parsed.is_sender);
                } catch {
                    // Ignore error
                }
            }

            const isVideoEvent = ev.event_type.includes('VIDEO');
            const isAudioEvent = ev.event_type === 'NOTE';
            const dateMonth = ev.timestamp.substring(0, 7);

            for (let i = 0; i < ev.media_references.length; i++) {
                const ref = ev.media_references[i];
                const clean = ref.split('?')[0].toLowerCase();
                const isVideo = isVideoEvent || clean.endsWith('.mp4') || clean.endsWith('.mov') || clean.endsWith('.webm');
                const isAudio = isAudioEvent || clean.endsWith('.m4a') || clean.endsWith('.aac') || clean.endsWith('.opus') || clean.endsWith('.mp3');

                let computedType = 'Image';
                if (isVideo) computedType = 'Video';
                if (isAudio) computedType = 'Audio';

                list.push({
                    id: `${ev.id}_${i}`,
                    eventId: ev.id,
                    timestamp: ev.timestamp,
                    sender: ev.sender,
                    sender_name: ev.sender_name,
                    media_path: ref,
                    path: ref,
                    media_references: [ref],
                    media_type: computedType,
                    event_type: ev.event_type,
                    isSender,
                    dateMonth
                });
            }
        }
        return list;
    }, [events]);

    // Available months for filtering
    const availableMonths = useMemo(() => {
        const set = new Set<string>();
        for (const item of allMediaItems) {
            if (item.dateMonth) set.add(item.dateMonth);
        }
        return Array.from(set).sort((a, b) => b.localeCompare(a));
    }, [allMediaItems]);

    // Filtered media items
    const filteredItems = useMemo(() => {
        return allMediaItems.filter((item) => {
            // Type Filter
            if (typeFilter === 'SNAPS') {
                if (item.event_type !== 'SNAP' && item.event_type !== 'SNAP_VIDEO') return false;
            } else if (typeFilter === 'PHOTOS') {
                if (item.media_type !== 'Image') return false;
            } else if (typeFilter === 'VIDEOS') {
                if (item.media_type !== 'Video') return false;
            } else if (typeFilter === 'AUDIO') {
                if (item.media_type !== 'Audio') return false;
            }

            // Direction Filter
            if (directionFilter === 'SENT' && !item.isSender) return false;
            if (directionFilter === 'RECEIVED' && item.isSender) return false;

            // Month Filter
            if (monthFilter !== 'ALL' && item.dateMonth !== monthFilter) return false;

            // Search query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchSender = (item.sender_name || item.sender || '').toLowerCase().includes(q);
                const matchDate = (item.timestamp || '').toLowerCase().includes(q);
                if (!matchSender && !matchDate) return false;
            }

            return true;
        });
    }, [allMediaItems, typeFilter, directionFilter, monthFilter, searchQuery]);

    const stats = useMemo(() => {
        let snaps = 0;
        let photos = 0;
        let videos = 0;
        let audio = 0;
        for (const item of allMediaItems) {
            if (item.event_type === 'SNAP' || item.event_type === 'SNAP_VIDEO') snaps++;
            if (item.media_type === 'Image') photos++;
            if (item.media_type === 'Video') videos++;
            if (item.media_type === 'Audio') audio++;
        }
        return { total: allMediaItems.length, snaps, photos, videos, audio };
    }, [allMediaItems]);

    return (
        <div className="flex-1 flex flex-col bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100 h-full overflow-hidden relative">
            {/* Header */}
            <div className="h-20 bg-white/90 dark:bg-surface-900/90 backdrop-blur-md border-b border-surface-200 dark:border-surface-800 px-8 flex items-center justify-between z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="p-2.5 rounded-xl bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 border border-surface-200 dark:border-surface-700/60 text-surface-700 dark:text-surface-200 transition-colors cursor-pointer"
                        title="Back to Chat"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h2 className="font-bold text-lg text-surface-900 dark:text-white flex items-center gap-2.5">
                            <span>Chat Gallery</span>
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300 font-semibold border border-brand-500/20 dark:border-brand-500/30">
                                {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
                            </span>
                        </h2>
                        <p className="text-xs text-surface-500 dark:text-surface-400 font-medium">
                            Media shared in {conversationName}
                        </p>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative w-64">
                    <Search className="w-4 h-4 text-surface-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search by date or sender..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl text-xs text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-colors"
                    />
                </div>
            </div>

            {/* Filter Control Bar */}
            <div className="px-8 py-3.5 bg-white/60 dark:bg-surface-900/40 border-b border-surface-200 dark:border-surface-800/80 flex flex-wrap items-center justify-between gap-4 shrink-0">
                {/* Media Type Tabs */}
                <div className="flex items-center gap-1.5 p-1 bg-surface-100 dark:bg-surface-950/60 rounded-xl border border-surface-200 dark:border-surface-800">
                    <button
                        onClick={() => setTypeFilter('ALL')}
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer",
                            typeFilter === 'ALL'
                                ? "bg-brand-500 text-white shadow-xs"
                                : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                        )}
                    >
                        All ({stats.total})
                    </button>
                    <button
                        onClick={() => setTypeFilter('SNAPS')}
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                            typeFilter === 'SNAPS'
                                ? "bg-purple-600 text-white shadow-xs"
                                : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                        )}
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        Snaps ({stats.snaps})
                    </button>
                    <button
                        onClick={() => setTypeFilter('PHOTOS')}
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                            typeFilter === 'PHOTOS'
                                ? "bg-brand-500 text-white shadow-xs"
                                : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                        )}
                    >
                        <ImageIcon className="w-3.5 h-3.5" />
                        Photos ({stats.photos})
                    </button>
                    <button
                        onClick={() => setTypeFilter('VIDEOS')}
                        className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                            typeFilter === 'VIDEOS'
                                ? "bg-brand-500 text-white shadow-xs"
                                : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                        )}
                    >
                        <Video className="w-3.5 h-3.5" />
                        Videos ({stats.videos})
                    </button>
                    {stats.audio > 0 && (
                        <button
                            onClick={() => setTypeFilter('AUDIO')}
                            className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                                typeFilter === 'AUDIO'
                                    ? "bg-accent-cyan text-white shadow-xs"
                                    : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                            )}
                        >
                            <Volume2 className="w-3.5 h-3.5" />
                            Audio ({stats.audio})
                        </button>
                    )}
                </div>

                {/* Right controls: Direction & Month */}
                <div className="flex items-center gap-3">
                    {/* Sent / Received Filter */}
                    <div className="flex items-center gap-1 p-1 bg-surface-100 dark:bg-surface-950/60 rounded-xl border border-surface-200 dark:border-surface-800">
                        <button
                            onClick={() => setDirectionFilter('ALL')}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                                directionFilter === 'ALL'
                                    ? "bg-white dark:bg-surface-800 text-surface-900 dark:text-white shadow-xs font-bold"
                                    : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                            )}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setDirectionFilter('SENT')}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer",
                                directionFilter === 'SENT'
                                    ? "bg-white dark:bg-surface-800 text-brand-600 dark:text-brand-300 font-bold shadow-xs"
                                    : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                            )}
                        >
                            <Send className="w-3 h-3 text-brand-500" />
                            Sent
                        </button>
                        <button
                            onClick={() => setDirectionFilter('RECEIVED')}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer",
                                directionFilter === 'RECEIVED'
                                    ? "bg-white dark:bg-surface-800 text-purple-600 dark:text-purple-300 font-bold shadow-xs"
                                    : "text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                            )}
                        >
                            <Inbox className="w-3 h-3 text-purple-500" />
                            Received
                        </button>
                    </div>

                    {/* Month Filter Dropdown */}
                    {availableMonths.length > 0 && (
                        <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-surface-400" />
                            <select
                                value={monthFilter}
                                onChange={(e) => setMonthFilter(e.target.value)}
                                className="bg-surface-100 dark:bg-surface-950 border border-surface-200 dark:border-surface-800 rounded-xl px-3 py-1.5 text-xs text-surface-900 dark:text-white focus:outline-none focus:border-brand-500 cursor-pointer"
                            >
                                <option value="ALL">All Months</option>
                                {availableMonths.map((m) => (
                                    <option key={m} value={m}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* Content Gallery Grid */}
            <div className="flex-1 overflow-y-auto p-8">
                {loading ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-3 text-surface-500 dark:text-surface-400">
                        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
                        <p className="text-sm font-semibold">Loading conversation media...</p>
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center gap-3 text-surface-500 dark:text-surface-400 text-center">
                        <ImageIcon className="w-12 h-12 opacity-30 text-brand-500" />
                        <p className="font-bold text-base text-surface-900 dark:text-white">No media found</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400 max-w-sm">
                            Try adjusting your filters or search query to see media from this chat.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {filteredItems.map((item, idx) => (
                            <div key={item.id} className="relative group">
                                <MediaThumbnail
                                    path={item.media_path || undefined}
                                    mediaType={item.media_type || 'Image'}
                                    timestamp={item.timestamp}
                                    onClick={() => setViewerIndex(idx)}
                                />

                                {/* Quick action overlay on hover */}
                                <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onJumpToMessage(item.eventId);
                                        }}
                                        className="p-1.5 rounded-lg bg-black/70 hover:bg-black border border-white/20 text-white backdrop-blur-md transition-transform hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
                                        title="View in conversation"
                                    >
                                        <MessageSquare className="w-3.5 h-3.5 text-brand-400" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Media Viewer Modal */}
            <MediaViewer
                isOpen={viewerIndex >= 0}
                onClose={() => setViewerIndex(-1)}
                items={filteredItems}
                currentIndex={viewerIndex}
                onIndexChange={setViewerIndex}
                addToast={addToast}
            />
        </div>
    );
};
