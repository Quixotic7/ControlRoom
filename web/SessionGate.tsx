import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, isRemoteBrowser } from "./api";
export function SessionGate({ children }: { children: ReactNode }) {
  const remote = isRemoteBrowser();
  const dialog = useRef<HTMLDialogElement>(null);
  const [ready, setReady] = useState(!remote),
    [locked, setLocked] = useState(remote),
    [checking, setChecking] = useState(remote),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [hours, setHours] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!remote) return;
    let active = true;
    const lock = () => setLocked(true);
    window.addEventListener("controlroom:auth-required", lock);
    const refresh = () =>
      api("/session")
        .then((s) => {
          if (active) {
            setLocked(!s.authenticated);
            setHours(s.sessionHours);
            if (s.authenticated) setReady(true);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    void refresh();
    // Recover in place when the host switches a waiting browser to open LAN.
    const timer = locked ? window.setInterval(refresh, 5000) : undefined;
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("controlroom:auth-required", lock);
    };
  }, [remote, locked]);
  useEffect(() => {
    if (remote && locked) dialog.current?.showModal();
    else dialog.current?.close();
  }, [remote, locked, ready]);
  async function pair() {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/pair", "POST", { code });
      setCode("");
      setLocked(false);
      setReady(true);
      window.dispatchEvent(new Event("focus"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!remote) return <>{children}</>;
  return (
    <>
      {ready && <div hidden={locked}>{children}</div>}
      {locked && (
        <dialog
          ref={dialog}
          className="pairing-dialog"
          onCancel={(e) => e.preventDefault()}
        >
          <section className="settings-card">
            <h1>Connect to Control Room</h1>
            <p>
              On the host Mac, open Settings & backups → Network access and
              generate a pairing code.
            </p>
            <p className="help">
              This is HTTP on a trusted local network. Traffic is not encrypted.
              {hours === null
                ? "The host chooses how long paired access lasts"
                : `Pairing grants access to this project for ${hours} ${hours === 1 ? "hour" : "hours"}`}
              ; the host can revoke access sooner.
            </p>
            {checking ? (
              <p>Checking this browser’s session…</p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void pair();
                }}
              >
                <label className="field">
                  Pairing code
                  <input
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
                <button
                  className="button primary"
                  disabled={busy || !code.trim()}
                >
                  {busy ? "Connecting…" : "Connect to project"}
                </button>
              </form>
            )}
            {error && (
              <p className="banner error" role="alert">
                {error}
              </p>
            )}
            <p className="help">
              No connection? Confirm both devices are on the same network, use
              the current address shown on the host, and check the host
              firewall. No port forwarding is needed.
            </p>
          </section>
        </dialog>
      )}
    </>
  );
}
