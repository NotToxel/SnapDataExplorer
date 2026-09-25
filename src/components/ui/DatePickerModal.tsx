import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Calendar, 
    X, 
    Clock, 
    Sparkles, 
    MessageSquare, 
    Zap, 
    Image as ImageIcon, 
    Volume2,
    ArrowRight
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { DateActivity } from '../../types';

interface DatePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    activeDates?: string[];
    activityData?: DateActivity[];
    onSelectDate: (date: string) => void;
}

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DatePickerModal: React.FC<DatePickerModalProps> = ({
    isOpen,
    onClose,
    activeDates = [],
    activityData = [],
    onSelectDate
}) => {
    // Map of date string -> DateActivity for O(1) stats lookups
    const activityMap = useMemo(() => {
        const map = new Map<string, DateActivity>();
        if (activityData && activityData.length > 0) {
            for (const item of activityData) {
                map.set(item.date, item);
            }
        }
        return map;
    }, [activityData]);

    // Unified list of all active dates
    const allDates = useMemo(() => {
        if (activityData && activityData.length > 0) {
            return activityData.map(a => a.date);
        }
        return activeDates;
    }, [activityData, activeDates]);

    // Set of active date strings for fast membership check
    const activeDateSet = useMemo(() => new Set(allDates), [allDates]);

    // Available years with activity
    const years = useMemo(() => {
        const yrSet = new Set<number>();
        for (const d of allDates) {
            const yr = parseInt(d.substring(0, 4), 10);
            if (!isNaN(yr)) yrSet.add(yr);
        }
        return Array.from(yrSet).sort((a, b) => b - a);
    }, [allDates]);

    const latestYear = years[0] || new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState<number>(latestYear);

    // Initial selected month
    const latestMonth = useMemo(() => {
        const datesInYear = allDates.filter(d => d.startsWith(`${selectedYear}-`));
        if (datesInYear.length > 0) {
            const last = datesInYear[datesInYear.length - 1];
            return parseInt(last.substring(5, 7), 10) - 1;
        }
        return new Date().getMonth();
    }, [allDates, selectedYear]);

    const [selectedMonth, setSelectedMonth] = useState<number>(latestMonth);
    const [hoveredDate, setHoveredDate] = useState<string | null>(null);

    // Active dates count & message/snap totals per month in the selected year
    const monthStats = useMemo(() => {
        const stats: Record<number, { count: number; messages: number; snaps: number }> = {};
        for (let m = 0; m < 12; m++) stats[m] = { count: 0, messages: 0, snaps: 0 };
        for (const d of allDates) {
            if (d.startsWith(`${selectedYear}-`)) {
                const m = parseInt(d.substring(5, 7), 10) - 1;
                stats[m].count += 1;
                const act = activityMap.get(d);
                if (act) {
                    stats[m].messages += act.total_messages;
                    stats[m].snaps += act.snap_count;
                }
            }
        }
        return stats;
    }, [allDates, selectedYear, activityMap]);

    // Calendar matrix for selected year & month
    const calendarDays = useMemo(() => {
        const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
        const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        
        const days: { day: number; dateStr: string; isActive: boolean; activity?: DateActivity }[] = [];
        
        // Blank cells before the 1st
        for (let i = 0; i < firstDay; i++) {
            days.push({ day: 0, dateStr: '', isActive: false });
        }
        
        for (let d = 1; d <= daysInMonth; d++) {
            const mm = String(selectedMonth + 1).padStart(2, '0');
            const dd = String(d).padStart(2, '0');
            const dateStr = `${selectedYear}-${mm}-${dd}`;
            const isActive = activeDateSet.has(dateStr);
            days.push({
                day: d,
                dateStr,
                isActive,
                activity: isActive ? activityMap.get(dateStr) : undefined
            });
        }
        return days;
    }, [selectedYear, selectedMonth, activeDateSet, activityMap]);

    // Month totals for currently viewed month
    const selectedMonthTotals = useMemo(() => {
        let messages = 0;
        let snaps = 0;
        let media = 0;
        let texts = 0;
        for (const d of calendarDays) {
            if (d.isActive && d.activity) {
                messages += d.activity.total_messages;
                snaps += d.activity.snap_count;
                media += d.activity.media_count;
                texts += d.activity.text_count;
            }
        }
        return { messages, snaps, media, texts };
    }, [calendarDays]);

    // Total lifetime activity summary
    const lifetimeSummary = useMemo(() => {
        let totalMsgs = 0;
        let totalSnaps = 0;
        for (const act of activityData) {
            totalMsgs += act.total_messages;
            totalSnaps += act.snap_count;
        }
        return { totalMsgs, totalSnaps };
    }, [activityData]);

    if (!isOpen) return null;

    const handleDayClick = (dateStr: string, isActive: boolean) => {
        if (!isActive) return;
        onSelectDate(dateStr);
        onClose();
    };

    const hoveredActivity = hoveredDate ? activityMap.get(hoveredDate) : null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ duration: 0.2 }}
                    className="w-full max-w-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-surface-900 dark:text-surface-100"
                >
                    {/* Header */}
                    <div className="px-6 py-5 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between bg-surface-50/80 dark:bg-surface-950/40">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 shadow-inner">
                                <Calendar className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="font-bold text-base text-surface-900 dark:text-white flex items-center gap-2">
                                    Jump to Date
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-300 border border-brand-500/30">
                                        {allDates.length} Active Days
                                    </span>
                                    {lifetimeSummary.totalSnaps > 0 && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                            <Zap className="w-3 h-3 fill-amber-500" />
                                            {lifetimeSummary.totalSnaps} Snaps
                                        </span>
                                    )}
                                </h3>
                                <p className="text-xs text-surface-500 dark:text-surface-400">Select any day with message or snap history</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl text-surface-400 hover:text-surface-900 hover:bg-surface-100 dark:hover:text-white dark:hover:bg-surface-800 transition-colors cursor-pointer"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Year Tabs */}
                    {years.length > 0 && (
                        <div className="px-6 pt-4 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                            <span className="text-xs font-bold text-surface-500 dark:text-surface-400 mr-1 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" /> Year:
                            </span>
                            {years.map((yr) => (
                                <button
                                    key={yr}
                                    onClick={() => setSelectedYear(yr)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer",
                                        selectedYear === yr
                                            ? "bg-brand-500 text-white shadow-md shadow-brand-500/30"
                                            : "bg-surface-100 hover:bg-surface-200 text-surface-700 dark:bg-surface-800/80 dark:hover:bg-surface-800 dark:text-surface-300 dark:hover:text-white"
                                    )}
                                >
                                    {yr}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Month Picker Row */}
                    <div className="px-6 py-3 grid grid-cols-6 gap-1.5">
                        {SHORT_MONTHS.map((name, idx) => {
                            const st = monthStats[idx] || { count: 0, messages: 0, snaps: 0 };
                            const hasActivity = st.count > 0;
                            const isSelected = selectedMonth === idx;
                            return (
                                <button
                                    key={name}
                                    onClick={() => setSelectedMonth(idx)}
                                    className={cn(
                                        "py-2 px-1 rounded-xl text-xs font-semibold flex flex-col items-center justify-center transition-all cursor-pointer relative",
                                        isSelected
                                            ? "bg-purple-600 text-white font-bold shadow-md shadow-purple-600/30 ring-1 ring-purple-400"
                                            : hasActivity
                                            ? "bg-surface-100 hover:bg-surface-200/80 text-surface-800 border border-surface-200/70 dark:border-transparent dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700"
                                            : "bg-surface-50 text-surface-400 border border-surface-100 dark:border-transparent dark:bg-surface-950/30 dark:text-surface-600 cursor-default"
                                    )}
                                >
                                    <span>{name}</span>
                                    {hasActivity && (
                                        <span className={cn(
                                            "text-[9px] mt-0.5 leading-none font-bold",
                                            isSelected ? "text-purple-200" : "text-brand-600 dark:text-brand-400"
                                        )}>
                                            {st.count}d {st.snaps > 0 ? `⚡${st.snaps}` : ''}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Month Days Grid */}
                    <div className="px-6 pt-2 pb-3">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <span className="font-bold text-sm text-surface-900 dark:text-white">
                                {MONTH_NAMES[selectedMonth]} {selectedYear}
                            </span>
                            <span className="text-xs text-brand-600 dark:text-brand-400 font-semibold flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                {monthStats[selectedMonth]?.count || 0} active days • {selectedMonthTotals.messages} messages
                            </span>
                        </div>

                        {/* Day headers */}
                        <div className="grid grid-cols-7 gap-1.5 text-center mb-1.5">
                            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
                                <span key={d} className="text-[10px] font-bold text-surface-400 dark:text-surface-500 uppercase tracking-wider py-1">
                                    {d}
                                </span>
                            ))}
                        </div>

                        {/* Days Grid */}
                        <div className="grid grid-cols-7 gap-1.5">
                            {calendarDays.map((item, i) => {
                                if (item.day === 0) {
                                    return <div key={`empty-${i}`} className="aspect-square" />;
                                }

                                const activity = item.activity;
                                const isHovered = hoveredDate === item.dateStr;
                                const hasSnaps = activity && activity.snap_count > 0;
                                const totalMsgs = activity?.total_messages || 0;

                                return (
                                    <div key={item.dateStr} className="relative">
                                        <button
                                            onClick={() => handleDayClick(item.dateStr, item.isActive)}
                                            onMouseEnter={() => item.isActive && setHoveredDate(item.dateStr)}
                                            onMouseLeave={() => setHoveredDate(null)}
                                            onFocus={() => item.isActive && setHoveredDate(item.dateStr)}
                                            onBlur={() => setHoveredDate(null)}
                                            disabled={!item.isActive}
                                            className={cn(
                                                "w-full aspect-square rounded-xl flex flex-col items-center justify-center p-1 transition-all relative select-none",
                                                item.isActive
                                                    ? hasSnaps
                                                        ? "bg-amber-500/10 text-surface-900 dark:text-surface-100 border border-amber-500/40 hover:bg-amber-500 hover:text-black hover:border-amber-400 cursor-pointer shadow-xs active:scale-95"
                                                        : totalMsgs > 30
                                                        ? "bg-brand-500/15 text-brand-800 dark:text-brand-100 border border-brand-500/40 hover:bg-brand-500 hover:text-white cursor-pointer shadow-xs active:scale-95"
                                                        : "bg-brand-500/10 text-brand-700 dark:text-brand-200 border border-brand-500/30 hover:bg-brand-500 hover:text-white cursor-pointer shadow-xs active:scale-95"
                                                    : "text-surface-300 dark:text-surface-600 bg-surface-50/50 dark:bg-surface-950/20 cursor-not-allowed opacity-40",
                                                isHovered && "scale-105 z-10 ring-2 ring-brand-500/40"
                                            )}
                                        >
                                            <span className={cn(
                                                "text-xs font-black transition-transform",
                                                isHovered && "scale-110"
                                            )}>
                                                {item.day}
                                            </span>

                                            {item.isActive && (
                                                <div className="flex items-center gap-0.5 mt-0.5 pointer-events-none">
                                                    {totalMsgs > 0 ? (
                                                        <span className="text-[9px] font-bold opacity-80 leading-none">
                                                            {totalMsgs > 999 ? `${(totalMsgs / 1000).toFixed(1)}k` : totalMsgs}
                                                        </span>
                                                    ) : (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-brand-500 dark:bg-brand-400" />
                                                    )}
                                                    {hasSnaps && (
                                                        <span className="text-[9px] font-black text-amber-500 dark:text-amber-400 leading-none">
                                                            ⚡{activity.snap_count}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </button>

                                        {/* Themed Floating Micro-Tooltip right above cell on hover */}
                                        {isHovered && item.isActive && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 4, scale: 0.94 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.94 }}
                                                transition={{ duration: 0.12 }}
                                                className="absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-surface-900 dark:bg-white text-white dark:text-surface-900 rounded-lg shadow-xl text-[10px] font-bold whitespace-nowrap z-50 pointer-events-none flex items-center gap-1.5 border border-surface-700/60 dark:border-surface-200"
                                            >
                                                <span>{totalMsgs} msgs</span>
                                                {hasSnaps && (
                                                    <span className="text-amber-400 dark:text-amber-600 font-extrabold flex items-center gap-0.5">
                                                        ⚡{activity.snap_count} snaps
                                                    </span>
                                                )}
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-surface-900 dark:border-t-white" />
                                            </motion.div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Rich Statistics Spotlight Card (Bottom of Modal) */}
                    <div className="px-6 pb-6 pt-1">
                        <AnimatePresence mode="wait">
                            {hoveredActivity ? (
                                <motion.div
                                    key={hoveredActivity.date}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ duration: 0.15 }}
                                    className="p-3.5 rounded-2xl bg-surface-50 dark:bg-surface-800/80 border border-surface-200 dark:border-surface-700/80 shadow-xs flex flex-col gap-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center text-brand-600 dark:text-brand-400 shadow-inner">
                                                <Calendar className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-surface-900 dark:text-white">
                                                    {new Date(`${hoveredActivity.date}T12:00:00`).toLocaleDateString(undefined, {
                                                        weekday: 'short',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        year: 'numeric'
                                                    })}
                                                </p>
                                                <span className="text-[10px] text-surface-500 dark:text-surface-400 font-medium">
                                                    {hoveredActivity.total_messages} total messages & snaps
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400 bg-brand-500/10 px-2.5 py-1 rounded-full border border-brand-500/20 flex items-center gap-1 shadow-xs">
                                            Jump to Day <ArrowRight className="w-3 h-3" />
                                        </span>
                                    </div>

                                    {/* Stats Breakdown Row */}
                                    <div className="grid grid-cols-4 gap-2 pt-1 border-t border-surface-200/70 dark:border-surface-700/70">
                                        <div className="flex items-center gap-2 bg-white dark:bg-surface-900/60 px-2.5 py-1.5 rounded-xl border border-surface-200/80 dark:border-surface-800 shadow-2xs">
                                            <MessageSquare className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] text-surface-400 uppercase font-semibold">Texts</span>
                                                <span className="text-xs font-black text-surface-800 dark:text-surface-100">{hoveredActivity.text_count}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 bg-white dark:bg-surface-900/60 px-2.5 py-1.5 rounded-xl border border-surface-200/80 dark:border-surface-800 shadow-2xs">
                                            <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] text-surface-400 uppercase font-semibold">Snaps</span>
                                                <span className="text-xs font-black text-amber-600 dark:text-amber-400">{hoveredActivity.snap_count}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 bg-white dark:bg-surface-900/60 px-2.5 py-1.5 rounded-xl border border-surface-200/80 dark:border-surface-800 shadow-2xs">
                                            <ImageIcon className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] text-surface-400 uppercase font-semibold">Photos</span>
                                                <span className="text-xs font-black text-surface-800 dark:text-surface-100">{hoveredActivity.media_count}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 bg-white dark:bg-surface-900/60 px-2.5 py-1.5 rounded-xl border border-surface-200/80 dark:border-surface-800 shadow-2xs">
                                            <Volume2 className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[9px] text-surface-400 uppercase font-semibold">Audio</span>
                                                <span className="text-xs font-black text-surface-800 dark:text-surface-100">{hoveredActivity.audio_count}</span>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="month-overview"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="p-3.5 rounded-2xl bg-surface-50/80 dark:bg-surface-950/40 border border-surface-200/70 dark:border-surface-800/80 flex items-center justify-between text-xs"
                                >
                                    <div className="flex items-center gap-2.5 text-surface-700 dark:text-surface-300">
                                        <Sparkles className="w-4 h-4 text-purple-500 shrink-0" />
                                        <span>
                                            <strong className="text-surface-900 dark:text-white font-bold">{MONTH_NAMES[selectedMonth]} {selectedYear}</strong>: {selectedMonthTotals.messages} messages ({selectedMonthTotals.snaps} snaps)
                                        </span>
                                    </div>
                                    <span className="text-[11px] text-surface-400 font-medium">Hover over any day for rich stats</span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
