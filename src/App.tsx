import { useState } from "react";
import { useSchedule } from "./hooks/useSchedule";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { StundenzettelTab } from "./components/StundenzettelTab";
import { DocsTab } from "./components/DocsTab";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { isAuthenticated, logout } from "./lib/auth";
import { monthLabel } from "./lib/shiftOps";

type TabId = "einstellungen" | "mitarbeiter" | "dienstplan" | "stundenzettel" | "docs";

const TABS: { id: TabId; label: string }[] = [
  { id: "einstellungen", label: "Cài đặt" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "dienstplan", label: "Lịch làm việc" },
  { id: "stundenzettel", label: "Bảng chấm công" },
  { id: "docs", label: "Tài liệu" },
];

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp onLogout={() => setUnlocked(false)} />;
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  const store = useSchedule();
  const [tab, setTab] = useState<TabId>("einstellungen");

  return (
    <div className="min-h-screen">
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-base sm:text-lg font-semibold">Lịch làm việc &amp; Bảng chấm công</h1>
            <p className="text-xs text-slate-300">
              {store.schedule.companyName || "Chưa có tên cửa hàng"} · {monthLabel(store.schedule.year, store.schedule.month)}
              {store.remoteStatus !== "off" && (
                <span
                  className={
                    store.remoteStatus === "error"
                      ? "ml-2 text-rose-300"
                      : "ml-2 text-slate-400"
                  }
                >
                  ·{" "}
                  {store.remoteStatus === "saving"
                    ? "đang đồng bộ…"
                    : store.remoteStatus === "error"
                      ? "lỗi đồng bộ — dữ liệu chỉ lưu trên máy này"
                      : "đã đồng bộ"}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                if (confirm("Xoá toàn bộ dữ liệu?")) store.resetAll();
              }}
              className="rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
            >
              Xoá dữ liệu
            </button>
            <button
              onClick={() => {
                logout();
                onLogout();
              }}
              className="rounded bg-slate-700 px-3 py-2 text-sm hover:bg-slate-600"
            >
              Đăng xuất
            </button>
          </div>
        </div>
      </header>

      <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4">
        <Dashboard store={store} />
      </div>

      <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 text-sm font-medium rounded-full border ${
                tab === t.id
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-[1500px] px-3 sm:px-4 py-4">
        <div className="no-print">
          {tab === "einstellungen" && <SettingsTab store={store} />}
          {tab === "mitarbeiter" && <EmployeesTab store={store} />}
          {tab === "docs" && <DocsTab />}
        </div>
        {/*
          „Bảng chấm công" enthält den Druckbereich (Stundenzettel UND
          Dienstplan) und darf deshalb NICHT im no-print-Container liegen: der
          wird beim Drucken auf display:none gesetzt, und ein Kind kann das
          nicht zurücknehmen. Der Tab blendet seine Bedienelemente selbst aus.
          Der Dienstplan liegt aus demselben Grund außerhalb – er bringt sein
          eigenes no-print mit und bleibt so unabhängig von dieser Reihenfolge.
        */}
        {tab === "dienstplan" && <ScheduleTab store={store} />}
        {tab === "stundenzettel" && <StundenzettelTab store={store} />}
      </main>
    </div>
  );
}
