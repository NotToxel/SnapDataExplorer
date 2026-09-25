import { useState, useEffect, useCallback, useRef } from "react";
import { Sidebar } from "./components/Sidebar";
import { ConversationList } from "./components/ConversationList";
import { ChatView } from "./components/ChatView";
import { Dashboard } from "./components/Dashboard";
import { SetupFlow } from "./components/SetupFlow";
import { SearchView } from "./components/SearchView";
import { GalleryView } from "./components/GalleryView";
import { MemoriesView } from "./components/MemoriesView";
import { ChillGallery } from "./components/ChillGallery";
import { Updater } from "./components/Updater";
import { AboutModal } from "./components/AboutModal";
import { ToastContainer } from "./components/Toast";
import { ExportSet, IngestionProgress, IngestionResult } from "./types";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { ViewMode } from "./components/ui/ModeToggle";
import { cn } from "./lib/utils";
import { motion, AnimatePresence } from "framer-motion";

function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [currentExport, setCurrentExport] = useState<ExportSet | null>(null);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("pro");
  const { theme, setTheme } = useTheme();
  const { toasts, addToast, removeToast } = useToast();

  const checkData = useCallback(async () => {
    try {
      const exports = await invoke<ExportSet[]>("get_exports");
      setHasData(exports.length > 0);
      if (exports.length > 0) {
        setCurrentExport(exports[0]);
      }
    } catch (e) {
      console.error("Failed to check data:", e);
      setHasData(false);
    }
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<IngestionProgress>("ingestion-progress", (event) => {
      setProgress(event.payload);
      if (event.payload.current_step === "Complete") {
        setRefreshTrigger((n) => n + 1);
        checkData().then(() => {
          setTimeout(() => setProgress(null), 3000);
        });
      }
    });

    const unlistenResult = listen<IngestionResult>("ingestion-result", (event) => {
      const r = event.payload;
      if (r.errors.length > 0) {
        addToast("error", `Import had ${r.errors.length} error(s): ${r.errors[0]}`);
      } else if (r.warnings.length > 0) {
        addToast("warning", `Imported with ${r.warnings.length} warning(s). ${r.conversations_parsed} conversations, ${r.events_parsed} messages.`);
      } else {
        addToast("success", `Imported ${r.conversations_parsed} conversations, ${r.events_parsed} messages, ${r.memories_parsed} memories.`);
      }
    });

    checkData();

    return () => {
      unlistenProgress.then((f) => f());
      unlistenResult.then((f) => f());
    };
  }, [checkData, addToast]);

  const isPopStateRef = useRef(false);

  const navigateTo = useCallback((page: string, convoId: string | null = null) => {
    setActivePage(page);
    setSelectedConvo(convoId);
    if (!isPopStateRef.current) {
      window.history.pushState({ page, convoId }, "");
    }
  }, []);

  const handleSelectConvo = useCallback((convoId: string | null) => {
    setSelectedConvo(convoId);
    if (!isPopStateRef.current) {
      window.history.pushState({ page: "chats", convoId }, "");
    }
  }, []);

  useEffect(() => {
    window.history.replaceState({ page: activePage, convoId: selectedConvo }, "");

    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.modal) return;
      isPopStateRef.current = true;
      if (e.state) {
        if (e.state.page) setActivePage(e.state.page);
        setSelectedConvo(e.state.convoId || null);
      } else {
        setActivePage("dashboard");
        setSelectedConvo(null);
      }
      setTimeout(() => {
        isPopStateRef.current = false;
      }, 0);
    };

    const handleMouseBack = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        window.history.back();
      } else if (e.button === 4) {
        e.preventDefault();
        window.history.forward();
      }
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("auxclick", handleMouseBack);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("auxclick", handleMouseBack);
    };
  }, []);

  function handleSelectExport(exp: ExportSet) {
    setCurrentExport(exp);
    navigateTo("dashboard");
  }

  function handleNavigateToChat(conversationId: string) {
    navigateTo("chats", conversationId);
  }

  async function handleResetData() {
    try {
      await invoke("reset_data");
      setHasData(false);
      setCurrentExport(null);
      setSelectedConvo(null);
      setActivePage("dashboard");
      setRefreshTrigger((n) => n + 1);
      addToast("info", "All data cleared. You can import a new export.");
    } catch (e) {
      addToast("error", `Failed to reset data: ${e}`);
    }
  }

  async function handleReimport() {
    try {
      addToast("info", "Reimporting data...");
      setActivePage("dashboard");
      setSelectedConvo(null);
      await invoke("reimport_data");
    } catch (e) {
      addToast("error", `Reimport failed: ${e}`);
    }
  }

  // Setup Flow (No data or explicit setup trigger)
  if (hasData === false || showSetup) {
    return (
      <>
        <SetupFlow
          progress={progress}
          onComplete={() => {
            setShowSetup(false);
            checkData();
          }}
          addToast={addToast}
        />
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </>
    );
  }

  // Loading State
  if (hasData === null) {
    return (
      <div className="h-screen w-screen bg-surface-950 flex flex-col items-center justify-center gap-4">
        <div className="w-14 h-14 border-4 border-surface-700 border-t-brand-500 rounded-full animate-spin" />
        <p className="text-surface-400 font-semibold animate-pulse">Initializing Snap Explorer...</p>
      </div>
    );
  }

  // Main Application Layout
  return (
    <div className={cn(
      "flex h-screen w-screen overflow-hidden font-sans transition-colors duration-300",
      viewMode === "chill"
        ? "bg-linear-to-br from-surface-900 via-surface-950 to-brand-950 text-white"
        : "bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100"
    )}>
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-4 z-50 md:hidden bg-surface-900 text-white w-10 h-10 rounded-xl flex items-center justify-center shadow-lg border border-surface-700"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
      >
        {sidebarOpen ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Sidebar with responsive visibility */}
      <div className={cn(
        "transition-transform duration-300 ease-out fixed md:relative z-40 h-full",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        viewMode === "chill" && "hidden md:hidden"
      )}>
        <Sidebar
          onSelectExport={handleSelectExport}
          onNavigate={(page) => { navigateTo(page, page === "chats" ? selectedConvo : null); if (window.innerWidth < 768) setSidebarOpen(false); }}
          onOpenSetup={() => setShowSetup(true)}
          onOpenAbout={() => setShowAbout(true)}
          onResetData={handleResetData}
          onReimport={handleReimport}
          activePage={activePage}
          theme={theme}
          onThemeChange={setTheme}
          refreshTrigger={refreshTrigger}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative">
        <AnimatePresence mode="wait">
          {viewMode === "chill" ? (
            <motion.div
              key="chill"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute inset-0 z-50"
            >
              <ChillGallery onExit={() => setViewMode("pro")} />
            </motion.div>
          ) : (
            <motion.div
              key={activePage}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="flex-1 flex overflow-hidden h-full w-full"
            >
              {activePage === "dashboard" && (
                <Dashboard currentExport={currentExport} progress={progress} viewMode={viewMode} onNavigate={navigateTo} />
              )}

              {activePage === "chats" && (
                <>
                  <ConversationList
                    onSelect={handleSelectConvo}
                    selectedId={selectedConvo}
                    refreshTrigger={refreshTrigger}
                  />
                  {selectedConvo ? (
                    <ChatView conversationId={selectedConvo} addToast={addToast} />
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-surface-50 dark:bg-surface-900 flex-col gap-4">
                      <span className="text-6xl animate-bounce text-surface-200 dark:text-surface-700">💬</span>
                      <p className="font-bold text-xl text-surface-400">Select a conversation</p>
                    </div>
                  )}
                </>
              )}

              {activePage === "search" && (
                <SearchView onNavigateToChat={handleNavigateToChat} addToast={addToast} />
              )}

              {activePage === "gallery" && <GalleryView addToast={addToast} />}

              {activePage === "memories" && <MemoriesView addToast={addToast} />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
      <Updater addToast={addToast} />
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Floating ingestion progress indicator when viewing other pages */}
      {progress && activePage !== "dashboard" && (
        <div
          onClick={() => setActivePage("dashboard")}
          className="fixed bottom-6 right-6 z-50 bg-white/95 dark:bg-surface-900/95 backdrop-blur-md border border-brand-500/40 shadow-2xl rounded-2xl p-4 max-w-sm w-full cursor-pointer hover:border-brand-400 transition-all text-surface-900 dark:text-white"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-brand-500 animate-ping" />
              {progress.current_step}
            </span>
            <span className="font-mono text-xs font-black text-brand-600 dark:text-brand-400">
              {Math.round(progress.progress * 100)}%
            </span>
          </div>
          <div className="w-full bg-surface-100 dark:bg-surface-800 rounded-full h-1.5 mb-2 overflow-hidden border border-surface-200 dark:border-transparent">
            <div
              className="bg-linear-to-r from-brand-500 to-accent-cyan h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.progress * 100}%` }}
            />
          </div>
          <p className="text-xs text-surface-600 dark:text-surface-400 font-medium truncate">{progress.message}</p>
        </div>
      )}
    </div>
  );
}

export default App;
