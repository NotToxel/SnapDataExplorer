import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    Filter,
    RefreshCw,
    FolderDown,
    MapPin,
    Layers,
    FolderOpen,
    Check,
    X,
    Calendar,
    Sparkles,
    AlertCircle,
    Loader2,
    RotateCcw,
    Image as ImageIcon,
    Video,
    Cloud
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import {
    Memory,
    ExportMemoriesOptions,
    ExportMemoriesProgress,
    ExportMemoriesResult,
    DiskSpaceInfo
} from '../types';
import { MediaThumbnail } from './ui/MediaThumbnail';
import { MediaViewer } from './ui/MediaViewer';
import { cn } from '../lib/utils';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface MemoriesViewProps {
    addToast?: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

export const MemoriesView: React.FC<MemoriesViewProps> = ({ addToast }) => {
    const [memories, setMemories] = useState<Memory[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterMediaType, setFilterMediaType] = useState<'All' | 'Image' | 'Video'>('All');
    const [filterAttribute, setFilterAttribute] = useState<'All' | 'Geotagged' | 'Overlay'>('All');
    const [filterYear, setFilterYear] = useState<string>('All');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showFilters, setShowFilters] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            return window.innerWidth >= 1024;
        }
        return true;
    });

    // Viewer state
    const [viewerIndex, setViewerIndex] = useState<number>(-1);

    // Export Modal state
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportPath, setExportPath] = useState<string | null>(null);
    const [diskInfo, setDiskInfo] = useState<DiskSpaceInfo | null>(null);
    const [namingFormat, setNamingFormat] = useState<string>('Standard');
    const [folderStructure, setFolderStructure] = useState<string>('Flat');
    const [compositeOverlay, setCompositeOverlay] = useState<boolean>(true);
    const [embedExif, setEmbedExif] = useState<boolean>(true);
    const [setFileTimes, setSetFileTimes] = useState<boolean>(true);
    const [isExporting, setIsExporting] = useState<boolean>(false);
    const [exportProgress, setExportProgress] = useState<ExportMemoriesProgress | null>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [allMemories, savedPath] = await Promise.all([
                invoke<Memory[]>("get_memories"),
                invoke<string | null>("get_storage_path")
            ]);
            setMemories(allMemories);
            if (savedPath) {
                setExportPath(savedPath);
                try {
                    const info = await invoke<DiskSpaceInfo>("check_disk_space", { path: savedPath });
                    setDiskInfo(info);
                } catch {
                    // Ignore disk space check error
                }
            }
        } catch (e) {
            console.error("Failed to load memories data:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();

        const unlistenProgress = listen<ExportMemoriesProgress>("export-memories-progress", (event) => {
            setExportProgress(event.payload);
        });

        return () => {
            unlistenProgress.then(f => f());
        };
    }, [loadData]);

    const handleSelectPath = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Select Destination Folder for Exported Memories"
            });

            if (selected && typeof selected === 'string') {
                setExportPath(selected);
                invoke("set_storage_path", { path: selected }).catch(() => {});
                try {
                    const info = await invoke<DiskSpaceInfo>("check_disk_space", { path: selected });
                    setDiskInfo(info);
                } catch {
                    // Ignore disk space check error
                }
            }
        } catch (e) {
            console.error("Failed to select folder:", e);
        }
    };

    const handleStartExport = async () => {
        if (!exportPath) {
            addToast?.('warning', 'Please select an export destination folder.');
            return;
        }

        const idsToExport = selectedIds.size > 0
            ? Array.from(selectedIds)
            : filteredMemories.map(m => m.id);

        if (idsToExport.length === 0) {
            addToast?.('warning', 'No memories match your selection to export.');
            return;
        }

        try {
            setIsExporting(true);
            setExportProgress({ current: 0, total: idsToExport.length, current_file: '', percentage: 0 });

            const options: ExportMemoriesOptions = {
                export_id: memories[0]?.export_id || '',
                memory_ids: idsToExport,
                target_dir: exportPath,
                naming_format: namingFormat,
                folder_structure: folderStructure as "Flat" | "ByYear" | "ByYearMonth",
                composite_overlay: compositeOverlay,
                embed_exif: embedExif,
                set_file_times: setFileTimes,
            };

            const result = await invoke<ExportMemoriesResult>("export_memories", { options });
            addToast?.('success', `Exported ${result.exported_count} memories successfully to ${exportPath}!`);
            setExportModalOpen(false);
        } catch (e: any) {
            console.error("Export failed:", e);
            addToast?.('error', `Export failed: ${e?.message || e}`);
        } finally {
            setIsExporting(false);
            setExportProgress(null);
        }
    };

    // Calculate unique years from memories
    const availableYears = useMemo(() => {
        const years = new Set<string>();
        for (const m of memories) {
            if (m.timestamp) {
                const y = new Date(m.timestamp).getFullYear().toString();
                if (!isNaN(Number(y))) years.add(y);
            }
        }
        return Array.from(years).sort().reverse();
    }, [memories]);

    // Filter logic
    const filteredMemories = useMemo(() => {
        return memories.filter(m => {
            // Search query
            if (searchQuery.trim() !== "") {
                const q = searchQuery.toLowerCase();
                const matchesDate = m.timestamp.toLowerCase().includes(q);
                const matchesId = m.id.toLowerCase().includes(q);
                const matchesCoords = (m.latitude && m.latitude.toString().includes(q)) ||
                                     (m.longitude && m.longitude.toString().includes(q));
                if (!matchesDate && !matchesId && !matchesCoords) return false;
            }

            // Media type
            if (filterMediaType !== 'All') {
                if (filterMediaType === 'Image' && m.media_type.toLowerCase() !== 'image') return false;
                if (filterMediaType === 'Video' && m.media_type.toLowerCase() !== 'video') return false;
            }

            // Attributes
            if (filterAttribute === 'Geotagged' && (m.latitude === null || m.longitude === null)) return false;
            if (filterAttribute === 'Overlay' && !m.overlay_path) return false;

            // Year
            if (filterYear !== 'All') {
                const year = new Date(m.timestamp).getFullYear().toString();
                if (year !== filterYear) return false;
            }

            return true;
        });
    }, [memories, searchQuery, filterMediaType, filterAttribute, filterYear]);

    const stats = useMemo(() => {
        return {
            total: memories.length,
            photos: memories.filter(m => m.media_type.toLowerCase() === 'image').length,
            videos: memories.filter(m => m.media_type.toLowerCase() === 'video').length,
            geotagged: memories.filter(m => m.latitude !== null && m.longitude !== null).length,
            withOverlay: memories.filter(m => m.overlay_path !== null).length,
        };
    }, [memories]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filterMediaType !== 'All') count++;
        if (filterAttribute !== 'All') count++;
        if (filterYear !== 'All') count++;
        return count;
    }, [filterMediaType, filterAttribute, filterYear]);

    const resetFilters = useCallback(() => {
        setFilterMediaType('All');
        setFilterAttribute('All');
        setFilterYear('All');
        setSearchQuery('');
    }, []);

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredMemories.length && filteredMemories.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredMemories.map(m => m.id)));
        }
    };

    const gridColsClass = useMemo(() => {
        if (showFilters) {
            return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 sm:gap-3.5 pr-1 sm:pr-2";
        }
        return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2.5 sm:gap-3.5 pr-1 sm:pr-2";
    }, [showFilters]);

    const renderOverviewCard = () => (
        <Card className="bg-white dark:bg-surface-900/60 border-surface-200 dark:border-surface-800 p-3.5 flex flex-col gap-2.5 shadow-xs shrink-0">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-surface-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    Overview
                </h3>
                <span className="text-[11px] font-mono text-surface-400 dark:text-surface-500">{stats.total} total</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200/80 dark:border-surface-700/60 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1">
                        <span className="text-surface-500 dark:text-surface-400 text-[11px] font-semibold">Photos</span>
                        <ImageIcon className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    </div>
                    <span className="font-bold font-mono text-surface-900 dark:text-white text-base mt-1.5 tabular-nums">{stats.photos}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200/80 dark:border-surface-700/60 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1">
                        <span className="text-surface-500 dark:text-surface-400 text-[11px] font-semibold">Videos</span>
                        <Video className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                    </div>
                    <span className="font-bold font-mono text-surface-900 dark:text-white text-base mt-1.5 tabular-nums">{stats.videos}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200/80 dark:border-surface-700/60 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1">
                        <span className="text-surface-500 dark:text-surface-400 text-[11px] font-semibold">Geotagged</span>
                        <MapPin className="w-3.5 h-3.5 text-accent-cyan shrink-0" />
                    </div>
                    <span className="font-bold font-mono text-surface-900 dark:text-white text-base mt-1.5 tabular-nums">{stats.geotagged}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200/80 dark:border-surface-700/60 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1">
                        <span className="text-surface-500 dark:text-surface-400 text-[11px] font-semibold">Overlays</span>
                        <Layers className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    </div>
                    <span className="font-bold font-mono text-surface-900 dark:text-white text-base mt-1.5 tabular-nums">{stats.withOverlay}</span>
                </div>
            </div>
        </Card>
    );

    const renderFiltersContent = () => (
        <div className="flex flex-col gap-4">
            {/* Media Type Section */}
            <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-surface-400 dark:text-surface-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    Media Type
                </h4>
                <div className="flex flex-col gap-1">
                    {[
                        { key: 'All', label: 'All Media', count: stats.total, icon: <Layers className="w-4 h-4 text-purple-500 shrink-0" /> },
                        { key: 'Image', label: 'Photos', count: stats.photos, icon: <ImageIcon className="w-4 h-4 text-purple-500 shrink-0" /> },
                        { key: 'Video', label: 'Videos', count: stats.videos, icon: <Video className="w-4 h-4 text-brand-500 shrink-0" /> },
                    ].map(({ key, label, count, icon }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setFilterMediaType(key as any)}
                            className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer",
                                filterMediaType === key
                                    ? "bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30 shadow-xs font-bold"
                                    : "text-surface-600 hover:text-surface-900 hover:bg-surface-50 dark:text-surface-400 dark:hover:bg-surface-800/60 dark:hover:text-white border border-transparent"
                            )}
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                {icon}
                                <span className="font-medium">{label}</span>
                            </div>
                            <span className={cn(
                                "font-mono text-[11px] shrink-0 tabular-nums ml-2",
                                filterMediaType === key
                                    ? "text-purple-700 dark:text-purple-300 font-bold"
                                    : "opacity-60 text-surface-400 dark:text-surface-500"
                            )}>
                                {count}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Features & Tags Section */}
            <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-surface-400 dark:text-surface-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    Features
                </h4>
                <div className="flex flex-col gap-1">
                    {[
                        {
                            key: 'All',
                            label: 'All Items',
                            count: stats.total,
                            icon: <Cloud className="w-4 h-4 text-purple-500 shrink-0" />
                        },
                        {
                            key: 'Geotagged',
                            label: 'GPS Location',
                            count: stats.geotagged,
                            icon: <MapPin className="w-4 h-4 text-cyan-500 shrink-0" />
                        },
                        {
                            key: 'Overlay',
                            label: 'With Overlay',
                            count: stats.withOverlay,
                            icon: <Layers className="w-4 h-4 text-amber-500 shrink-0" />
                        },
                    ].map(({ key, label, count, icon }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setFilterAttribute(key as any)}
                            className={cn(
                                "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer",
                                filterAttribute === key
                                    ? "bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30 shadow-xs font-bold"
                                    : "text-surface-600 hover:text-surface-900 hover:bg-surface-50 dark:text-surface-400 dark:hover:bg-surface-800/60 dark:hover:text-white border border-transparent"
                            )}
                        >
                            <div className="flex items-center gap-2.5 min-w-0">
                                {icon}
                                <span className="font-medium">{label}</span>
                            </div>
                            <span className={cn(
                                "font-mono text-[11px] shrink-0 tabular-nums ml-2",
                                filterAttribute === key
                                    ? "text-purple-700 dark:text-purple-300 font-bold"
                                    : "opacity-60 text-surface-400 dark:text-surface-500"
                            )}>
                                {count}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Year Selector */}
            {availableYears.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-surface-400 dark:text-surface-500 uppercase tracking-widest flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        Year
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                        <button
                            type="button"
                            onClick={() => setFilterYear('All')}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                                filterYear === 'All'
                                    ? "bg-purple-600 text-white font-bold shadow-xs shadow-purple-600/25 border border-purple-600"
                                    : "bg-surface-100 dark:bg-surface-800/80 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-white border border-surface-200/60 dark:border-surface-700/60"
                            )}
                        >
                            All
                        </button>
                        {availableYears.map(year => (
                            <button
                                key={year}
                                type="button"
                                onClick={() => setFilterYear(year)}
                                className={cn(
                                    "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer",
                                    filterYear === year
                                        ? "bg-purple-600 text-white font-bold shadow-xs shadow-purple-600/25 border border-purple-600"
                                        : "bg-surface-100 dark:bg-surface-800/80 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-white border border-surface-200/60 dark:border-surface-700/60"
                                )}
                            >
                                {year}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Reset Filters Button */}
            {activeFilterCount > 0 && (
                <button
                    type="button"
                    onClick={resetFilters}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-surface-200 dark:border-surface-700/80 bg-surface-50 hover:bg-surface-100 dark:bg-surface-800/60 dark:hover:bg-surface-800 text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-white text-xs font-semibold transition-all cursor-pointer shadow-2xs"
                >
                    <RotateCcw className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    Reset All Filters
                </button>
            )}
        </div>
    );

    return (
        <div className="flex-1 flex flex-col h-full bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100 overflow-hidden p-3 sm:p-5 lg:p-6 gap-3 sm:gap-4 min-h-0">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                        <h1 className="text-2xl sm:text-3xl font-black text-surface-900 dark:text-white tracking-tight flex items-center gap-2.5">
                            <Cloud className="w-7 h-7 sm:w-8 sm:h-8 text-purple-600 dark:text-purple-500" />
                            Memories
                        </h1>
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 text-[11px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1 shrink-0">
                            <Sparkles className="w-3 h-3" />
                            {stats.total} Total
                        </span>
                        {stats.geotagged > 0 && (
                            <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 text-[11px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1 shrink-0">
                                <MapPin className="w-3 h-3" />
                                {stats.geotagged} Geotagged
                            </span>
                        )}
                    </div>
                    <p className="text-xs sm:text-sm text-surface-500 dark:text-surface-400 font-medium mt-1 line-clamp-1 sm:line-clamp-none">
                        Explore your pre-packaged Snapchat memories and export them with standard EXIF date and GPS tags.
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={loadData}
                        className="bg-white hover:bg-surface-100 text-surface-700 border-surface-200 dark:bg-surface-800/80 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-700 text-xs px-2.5 sm:px-3.5 py-1.5 h-8 sm:h-9 font-semibold"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5 mr-1 sm:mr-1.5", loading && "animate-spin")} />
                        <span className="hidden sm:inline">Refresh</span>
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setExportModalOpen(true)}
                        disabled={memories.length === 0}
                        className="bg-purple-600 hover:bg-purple-500 shadow-md shadow-purple-600/25 text-white font-bold cursor-pointer text-xs px-3 sm:px-4 py-1.5 h-8 sm:h-9"
                    >
                        <FolderDown className="w-4 h-4 mr-1.5 shrink-0" />
                        <span>
                            <span className="hidden md:inline">Export & Organize</span>
                            <span className="md:hidden">Export</span>
                            {" "}({selectedIds.size > 0 ? selectedIds.size : stats.total})
                        </span>
                    </Button>
                </div>
            </header>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col lg:flex-row gap-3 sm:gap-4 lg:gap-5 overflow-hidden min-h-0">

                {/* Left: Desktop Sidebar (visible on lg+ when showFilters is true) */}
                {showFilters && (
                    <div className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col gap-3 overflow-y-auto no-scrollbar pb-6">
                        {renderOverviewCard()}
                        <Card className="bg-white dark:bg-surface-900/60 border-surface-200 dark:border-surface-800 p-3.5 flex flex-col gap-3.5 shadow-xs">
                            {renderFiltersContent()}
                        </Card>
                    </div>
                )}

                {/* Right / Center: Gallery & Toolbar */}
                <div className="flex-1 flex flex-col gap-3 min-w-0 h-full overflow-hidden">

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                        <div className="flex-1 min-w-[140px] sm:min-w-[200px] relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500 group-focus-within:text-purple-600 dark:group-focus-within:text-purple-400 transition-colors" />
                            <input
                                type="text"
                                placeholder="Search memories (date, coordinates, ID)..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-white dark:bg-surface-900/60 border border-surface-200 dark:border-surface-800 rounded-xl py-1.5 sm:py-2 pl-9 pr-3 text-xs sm:text-sm text-surface-900 dark:text-white placeholder-surface-400 dark:placeholder-surface-500 focus:outline-hidden focus:ring-2 focus:ring-purple-500/50 shadow-xs transition-all h-8 sm:h-9"
                            />
                        </div>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowFilters(!showFilters)}
                            className={cn(
                                "text-xs font-bold h-8 sm:h-9 px-2.5 sm:px-3",
                                showFilters
                                    ? "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-500/15 dark:border-purple-500/30 dark:text-purple-300"
                                    : "bg-white hover:bg-surface-100 border-surface-200 dark:bg-surface-800/80 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-700 text-surface-700"
                            )}
                        >
                            <Filter className="w-3.5 h-3.5 mr-1 sm:mr-1.5" />
                            <span>Filters</span>
                            {activeFilterCount > 0 && (
                                <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-purple-600 text-white text-[10px] font-bold">
                                    {activeFilterCount}
                                </span>
                            )}
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            onClick={toggleSelectAll}
                            className="bg-white hover:bg-surface-100 border-surface-200 dark:bg-surface-800/80 dark:border-surface-700 dark:text-surface-200 dark:hover:bg-surface-700 text-xs font-bold h-8 sm:h-9 px-2.5 sm:px-3"
                        >
                            {selectedIds.size === filteredMemories.length && filteredMemories.length > 0
                                ? "Deselect All"
                                : `Select All (${filteredMemories.length})`}
                        </Button>

                        {selectedIds.size > 0 && (
                            <Button
                                size="sm"
                                onClick={() => setExportModalOpen(true)}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-purple-600/25 h-8 sm:h-9"
                            >
                                <FolderDown className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                                <span className="hidden sm:inline">Export Selected</span>
                                <span className="sm:hidden">Export</span>
                                {" "}({selectedIds.size})
                            </Button>
                        )}
                    </div>

                    {/* Responsive Filters Accordion for screens < lg */}
                    <AnimatePresence>
                        {showFilters && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="lg:hidden overflow-hidden shrink-0"
                            >
                                <Card className="bg-white dark:bg-surface-900/90 border-surface-200 dark:border-surface-800 p-3 sm:p-4 flex flex-col gap-3 shadow-md max-h-[40vh] overflow-y-auto">
                                    {renderOverviewCard()}
                                    <div className="pt-2 border-t border-surface-200 dark:border-surface-800">
                                        {renderFiltersContent()}
                                    </div>
                                </Card>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Grid */}
                    <div className="flex-1 overflow-hidden pb-4 min-h-0">
                        {!loading && filteredMemories.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-surface-400 dark:text-white/20">
                                <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
                                <p className="font-bold text-base text-surface-700 dark:text-white/70">No memories found matching your filters.</p>
                            </div>
                        ) : (
                            <VirtuosoGrid
                                style={{ height: "100%", width: "100%" }}
                                data={filteredMemories}
                                overscan={300}
                                listClassName={gridColsClass}
                                itemContent={(_index, memory) => (
                                    <MediaThumbnail
                                        key={memory.id}
                                        path={memory.media_path || undefined}
                                        mediaType={memory.media_type}
                                        hasOverlay={Boolean(memory.overlay_path)}
                                        timestamp={memory.timestamp}
                                        isSelected={selectedIds.has(memory.id)}
                                        onSelect={(selected) => {
                                            const next = new Set(selectedIds);
                                            if (selected) next.add(memory.id);
                                            else next.delete(memory.id);
                                            setSelectedIds(next);
                                        }}
                                        onClick={() => setViewerIndex(memories.indexOf(memory))}
                                    />
                                )}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Media Lightbox */}
            <MediaViewer
                isOpen={viewerIndex >= 0}
                onClose={() => setViewerIndex(-1)}
                items={memories}
                currentIndex={viewerIndex}
                onIndexChange={setViewerIndex}
                addToast={addToast}
            />

            {/* Export & Organize Modal */}
            <AnimatePresence>
                {exportModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                        >
                            {/* Modal Header */}
                            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-surface-200 dark:border-surface-800">
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400">
                                        <FolderDown className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h2 className="text-base sm:text-lg font-bold text-surface-900 dark:text-white">Export & Organize Memories</h2>
                                        <p className="text-xs text-surface-500 dark:text-surface-400">
                                            {selectedIds.size > 0
                                                ? `Exporting ${selectedIds.size} selected memories`
                                                : `Exporting all ${filteredMemories.length} filtered memories`}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => !isExporting && setExportModalOpen(false)}
                                    disabled={isExporting}
                                    className="text-surface-400 hover:text-surface-600 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto no-scrollbar flex-1">

                                {/* Destination Folder */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider block">
                                        Destination Folder
                                    </label>
                                    <div
                                        onClick={!isExporting ? handleSelectPath : undefined}
                                        className={cn(
                                            "p-3 rounded-xl bg-surface-50 hover:bg-surface-100 border border-surface-200 dark:bg-surface-800/60 dark:border-surface-700 transition-all flex items-center justify-between",
                                            !isExporting && "cursor-pointer hover:border-purple-500/50"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 truncate mr-2">
                                            <FolderOpen className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0" />
                                            <span className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">
                                                {exportPath || "Click to choose destination folder..."}
                                            </span>
                                        </div>
                                        <Button size="sm" variant="outline" className="shrink-0 text-xs font-bold">
                                            Browse
                                        </Button>
                                    </div>
                                    {diskInfo && (
                                        <p className="text-[11px] text-surface-500 dark:text-surface-400">
                                            Available Space: {Math.round(diskInfo.available_bytes / (1024 * 1024 * 1024))} GB free
                                        </p>
                                    )}
                                </div>

                                {/* Folder Structure */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider block">
                                        Folder Structure
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {[
                                            { id: 'Flat', title: 'Flat Folder', desc: 'All files in root folder' },
                                            { id: 'ByYear', title: 'Group by Year', desc: 'e.g. 2024/' },
                                            { id: 'ByYearMonth', title: 'By Year & Month', desc: 'e.g. 2024/08/' },
                                        ].map(opt => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => setFolderStructure(opt.id)}
                                                className={cn(
                                                    "p-3 rounded-xl border text-left transition-all cursor-pointer",
                                                    folderStructure === opt.id
                                                        ? "border-purple-500 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 shadow-xs"
                                                        : "border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 bg-surface-50/50 dark:bg-surface-800/40 text-surface-700 dark:text-surface-300"
                                                )}
                                            >
                                                <div className="text-xs font-bold">{opt.title}</div>
                                                <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">{opt.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Naming Convention */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider block">
                                        Naming Convention
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {[
                                            { id: 'Standard', title: 'Standard Date', desc: 'YYYY-MM-DD_HH-mm-ss' },
                                            { id: 'Compact', title: 'Compact Date', desc: 'Snapchat_YYYYMMDD_HHMMSS' },
                                            { id: 'Original', title: 'Original Name', desc: 'Keep export stem' },
                                        ].map(opt => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => setNamingFormat(opt.id)}
                                                className={cn(
                                                    "p-3 rounded-xl border text-left transition-all cursor-pointer",
                                                    namingFormat === opt.id
                                                        ? "border-purple-500 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 shadow-xs"
                                                        : "border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 bg-surface-50/50 dark:bg-surface-800/40 text-surface-700 dark:text-surface-300"
                                                )}
                                            >
                                                <div className="text-xs font-bold">{opt.title}</div>
                                                <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">{opt.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Overlays Handling */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider block">
                                        Stickers & Overlays
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setCompositeOverlay(true)}
                                            className={cn(
                                                "p-3 rounded-xl border text-left transition-all cursor-pointer",
                                                compositeOverlay
                                                    ? "border-purple-500 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 shadow-xs"
                                                    : "border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 bg-surface-50/50 dark:bg-surface-800/40 text-surface-700 dark:text-surface-300"
                                            )}
                                        >
                                            <div className="text-xs font-bold">Burn Overlays into Photos</div>
                                            <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">Composite text/stickers onto photo directly</div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCompositeOverlay(false)}
                                            className={cn(
                                                "p-3 rounded-xl border text-left transition-all cursor-pointer",
                                                !compositeOverlay
                                                    ? "border-purple-500 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 shadow-xs"
                                                    : "border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 bg-surface-50/50 dark:bg-surface-800/40 text-surface-700 dark:text-surface-300"
                                            )}
                                        >
                                            <div className="text-xs font-bold">Export Separately</div>
                                            <div className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5">Save overlay as a companion _overlay.png</div>
                                        </button>
                                    </div>
                                </div>

                                {/* Metadata & Timestamp Checkboxes */}
                                <div className="p-3.5 sm:p-4 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 space-y-2.5">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={embedExif}
                                            onChange={(e) => setEmbedExif(e.target.checked)}
                                            className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 border-surface-300"
                                        />
                                        <div>
                                            <span className="text-xs font-bold text-surface-900 dark:text-white block">Embed EXIF Metadata</span>
                                            <span className="text-[11px] text-surface-500 dark:text-surface-400 block">Writes DateTimeOriginal and GPS coordinates into photo headers</span>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={setFileTimes}
                                            onChange={(e) => setSetFileTimes(e.target.checked)}
                                            className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 border-surface-300"
                                        />
                                        <div>
                                            <span className="text-xs font-bold text-surface-900 dark:text-white block">Set Filesystem Dates</span>
                                            <span className="text-[11px] text-surface-500 dark:text-surface-400 block">Matches file creation & modification times for sorting in Apple/Google Photos</span>
                                        </div>
                                    </label>
                                </div>

                                {/* Live Progress Indicator */}
                                {isExporting && exportProgress && (
                                    <div className="p-3.5 sm:p-4 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 space-y-2">
                                        <div className="flex justify-between text-xs font-bold text-purple-800 dark:text-purple-300">
                                            <span className="flex items-center gap-2">
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                Exporting: {exportProgress.current} / {exportProgress.total}
                                            </span>
                                            <span>{Math.round(exportProgress.percentage)}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-purple-200 dark:bg-purple-900/50 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-purple-600 transition-all duration-150"
                                                style={{ width: `${exportProgress.percentage}%` }}
                                            />
                                        </div>
                                        <p className="text-[10px] text-purple-600/70 dark:text-purple-300/60 truncate">
                                            {exportProgress.current_file}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="p-4 sm:p-5 border-t border-surface-200 dark:border-surface-800 flex justify-end gap-2.5 bg-surface-50/80 dark:bg-surface-950/60">
                                <Button
                                    variant="outline"
                                    onClick={() => setExportModalOpen(false)}
                                    disabled={isExporting}
                                    className="font-bold text-xs"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleStartExport}
                                    disabled={isExporting || !exportPath}
                                    className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-600/20"
                                >
                                    {isExporting ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Exporting...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="w-4 h-4 mr-2" />
                                            Start Export
                                        </>
                                    )}
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
