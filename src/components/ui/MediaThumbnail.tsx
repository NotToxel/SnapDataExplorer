import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Image as ImageIcon, Volume2, Layers } from 'lucide-react';
import { cn, safeConvertFileSrc } from '../../lib/utils';

interface MediaThumbnailProps {
    path?: string;
    remoteUrl?: string;
    mediaType: string; // "Image" | "Video" | "Audio"
    hasOverlay?: boolean;
    isSelected?: boolean;
    onSelect?: (selected: boolean) => void;
    onClick?: () => void;
    className?: string;
    timestamp?: string;
}

export const MediaThumbnail = React.memo(({
    path,
    remoteUrl,
    mediaType,
    hasOverlay,
    isSelected,
    onSelect,
    onClick,
    className,
    timestamp
}: MediaThumbnailProps) => {
    const [hasError, setHasError] = useState(false);

    const cleanPath = (path || remoteUrl || '').split('?')[0].toLowerCase();
    const isAudio = mediaType.toLowerCase() === 'audio' || cleanPath.endsWith('.m4a') || cleanPath.endsWith('.aac') || cleanPath.endsWith('.opus') || cleanPath.endsWith('.mp3');
    const isVideo = !isAudio && (mediaType.toLowerCase() === 'video' || cleanPath.endsWith('.mp4') || cleanPath.endsWith('.mov') || cleanPath.endsWith('.webm'));

    // Memoize the source to prevent re-calculations
    const rawSrc = useMemo(() => {
        if (path) {
            return safeConvertFileSrc(path) ?? null;
        }
        return remoteUrl ?? null;
    }, [path, remoteUrl]);

    // Ensure video seeks to first frame when metadata loads
    const videoSrc = useMemo(() => {
        if (!rawSrc || !isVideo) return null;
        return rawSrc.includes('#') ? rawSrc : `${rawSrc}#t=0.001`;
    }, [rawSrc, isVideo]);

    return (
        <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            layout
            className={cn(
                "relative rounded-xl overflow-hidden aspect-square cursor-pointer group bg-surface-200/60 dark:bg-black/40 border border-surface-200 dark:border-white/5 shadow-md dark:shadow-2xl transition-all duration-300",
                isSelected && "ring-2 ring-purple-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-950",
                className
            )}
            onClick={onClick}
        >
            {/* Media Content */}
            {rawSrc && !hasError ? (
                isAudio ? (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-linear-to-br from-surface-100 to-surface-200 dark:from-surface-800 dark:to-surface-950 p-4 text-center">
                        <div className="w-12 h-12 rounded-full bg-brand-500/10 dark:bg-brand-500/20 border border-brand-500/30 dark:border-brand-500/40 flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform">
                            <Volume2 className="w-6 h-6 text-brand-600 dark:text-brand-400" />
                        </div>
                        <span className="text-[11px] font-bold text-surface-800 dark:text-white/80 uppercase tracking-wider">Audio Note</span>
                        <div className="flex items-center gap-1 mt-2">
                            <span className="w-1 h-3 bg-brand-500 rounded-full animate-pulse" />
                            <span className="w-1 h-5 bg-brand-400 rounded-full animate-pulse delay-75" />
                            <span className="w-1 h-2 bg-brand-600 rounded-full animate-pulse delay-150" />
                            <span className="w-1 h-4 bg-brand-500 rounded-full animate-pulse delay-100" />
                        </div>
                    </div>
                ) : isVideo ? (
                    <video
                        src={videoSrc || undefined}
                        className="w-full h-full object-cover"
                        preload="metadata"
                        muted
                        loop
                        playsInline
                        onMouseOver={(e) => {
                            e.currentTarget.play().catch(() => { });
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0.001;
                        }}
                        onError={() => setHasError(true)}
                    />
                ) : (
                    <img
                        src={rawSrc}
                        alt="Thumbnail"
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => setHasError(true)}
                    />
                )
            ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-surface-100 dark:bg-zinc-900/50 backdrop-blur-xs text-surface-400 dark:text-zinc-500 gap-2">
                    {isVideo ? (
                        <Play className="w-8 h-8 opacity-20" />
                    ) : isAudio ? (
                        <Volume2 className="w-8 h-8 opacity-20" />
                    ) : (
                        <ImageIcon className="w-8 h-8 opacity-20" />
                    )}
                </div>
            )}

            {/* Overlays gradient */}
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            {/* Top Bar: Selection & Badges */}
            <div className="absolute top-2 left-2 right-2 flex justify-between items-start z-10">
                {onSelect && (
                    <div
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(!isSelected);
                        }}
                        className={cn(
                            "w-5 h-5 rounded-full border border-white/20 flex items-center justify-center transition-colors cursor-pointer",
                            isSelected ? "bg-purple-600 border-purple-500" : "bg-black/40 hover:bg-black/60"
                        )}
                    >
                        {isSelected && <div className="w-2 h-2 rounded-full bg-white shadow-xs" />}
                    </div>
                )}

                {hasOverlay && (
                    <div className="ml-auto px-1.5 py-0.5 rounded-md bg-purple-500/80 backdrop-blur-md border border-purple-300/30 text-white shadow-lg flex items-center gap-1" title="Has overlay/sticker">
                        <Layers className="w-3 h-3" />
                    </div>
                )}
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center transform translate-y-1 group-hover:translate-y-0 transition-transform duration-300 z-10 pointer-events-none">
                {timestamp && (
                    <span className="text-[10px] text-white/70 font-medium truncate max-w-[70%]">
                        {new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                    </span>
                )}
                {isVideo && (
                    <div className="p-1 rounded-md bg-white/10 backdrop-blur-xs border border-white/10">
                        <Play className="w-3 h-3 text-white fill-white" />
                    </div>
                )}
                {isAudio && (
                    <div className="p-1 rounded-md bg-white/10 backdrop-blur-xs border border-white/10">
                        <Volume2 className="w-3 h-3 text-accent-cyan" />
                    </div>
                )}
            </div>
        </motion.div>
    );
});

MediaThumbnail.displayName = "MediaThumbnail";
