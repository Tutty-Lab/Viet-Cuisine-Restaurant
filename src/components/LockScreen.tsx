import { useState } from "react";
import { login } from "../lib/auth";

/** Sperrbildschirm: ohne korrektes Passwort ist die App nicht sichtbar. */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Das Passwort wird gehasht verglichen, deshalb asynchron.
    if (await login(value)) {
      onUnlock();
    } else {
      setError(true);
      setValue("");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-900">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h1 className="text-lg font-semibold text-slate-900">Lịch làm việc &amp; Bảng chấm công</h1>
        <p className="mt-1 text-sm text-slate-500">Nhập mật khẩu để vào ứng dụng.</p>

        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder="Mật khẩu"
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-slate-900"
        />

        {error && <p className="mt-2 text-sm text-rose-600">Mật khẩu không đúng.</p>}

        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Vào ứng dụng
        </button>
      </form>
    </div>
  );
}
