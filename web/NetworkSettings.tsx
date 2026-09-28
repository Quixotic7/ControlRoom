import { useEffect, useState } from "react";
import { api } from "./api";
type NetworkState = {
  enabled: boolean;
  configured: boolean;
  boundToLan: boolean;
  restartRequired: boolean;
  urls: string[];
  sessions: number;
  port: number;
  transport: string;
  requirePairing: boolean;
  sessionHours: number;
};
export function NetworkSettings() {
  const [state, setState] = useState<NetworkState | null>(null),
    [pairing, setPairing] = useState<{
      code: string;
      expiresAt: string;
    } | null>(null),
    [error, setError] = useState(""),
    [hours, setHours] = useState("8"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<NetworkState>("/network")
      .then((s) => {
        setState(s);
        setHours(String(s.sessionHours));
      })
      .catch((e) => setError(String(e)));
  }, []);
  async function action(
    kind: "pairing" | "config" | "revoke",
    patch?: Partial<Pick<NetworkState, "requirePairing" | "sessionHours">> & {
      enabled?: boolean;
    },
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await api(
        "/network/" + kind,
        "POST",
        kind === "config" ? patch : {},
      );
      if (kind === "pairing") setPairing(result);
      else {
        setState(result);
        setHours(String(result.sessionHours));
        setPairing(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Network access</h2>
      {state && (
        <>
          <p>
            <strong>
              {state.enabled ? "LAN access enabled" : "Local access only"}
            </strong>{" "}
            · {state.sessions} paired browser sessions
          </p>
          <p className="help">
            {state.transport}{" "}
            {state.requirePairing
              ? "A paired browser can edit this project."
              : "Devices on this LAN can read and edit the project without a code."}{" "}
            Capture, imports, restore and host settings remain local.
          </p>
          {state.urls.map((url) => (
            <p key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            </p>
          ))}
          {state.enabled && !state.urls.length && (
            <p role="alert">
              No private IPv4 interface found. Connect the host to Wi-Fi or
              Ethernet and refresh Settings.
            </p>
          )}
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void action("config", { enabled: !state.configured })
            }
          >
            {state.configured ? "Disable LAN access" : "Enable LAN access"}
          </button>
          {state.restartRequired && (
            <div className="banner">
              <p>
                Restart the service to enable LAN listening. From the project
                directory:
              </p>
              <pre>
                ./.controlroom/controlroom stop{"\n"}./.controlroom/controlroom
                serve --lan --port {state.port}
              </pre>
              <p>
                Then reload this page. Existing project launchers also use the
                saved mode after restart.
              </p>
            </div>
          )}
          {!state.enabled && state.boundToLan && (
            <p className="help">
              Remote requests are blocked now. Restart the service to return the
              listener to loopback only.
            </p>
          )}
          <label className="check-row" style={{ marginTop: 16 }}>
            <input
              type="checkbox"
              checked={state.requirePairing}
              disabled={busy}
              onChange={(e) =>
                void action("config", { requirePairing: e.target.checked })
              }
            />{" "}
            Require pairing code
          </label>
          <p className="help">
            Turn off to open the board directly from devices on your trusted
            LAN. Changing this setting clears existing paired sessions and
            unused codes. Requiring a code again takes effect immediately.
          </p>
          {state.requirePairing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action("config", { sessionHours: Number(hours) });
              }}
            >
              <label className="field">
                Paired access duration (hours)
                <input
                  type="number"
                  min="0.25"
                  max="8760"
                  step="any"
                  required
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <p className="help">
                15 minutes to 365 days. Applies to new pairings; existing
                sessions keep their original expiry until revoked. A one-use
                pairing code itself expires after 10 minutes.
              </p>
              <button
                className="button"
                disabled={
                  busy || !hours || Number(hours) === state.sessionHours
                }
              >
                Save access duration
              </button>
            </form>
          ) : (
            <p className="help">
              No code or session timer is used. Access continues until you
              disable LAN or require a pairing code.
            </p>
          )}
          {state.enabled && state.requirePairing && (
            <div className="inline-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void action("pairing")}
              >
                Generate pairing code
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => void action("revoke")}
              >
                Revoke all remote sessions
              </button>
            </div>
          )}
          {pairing && (
            <div className="pairing-code">
              <label className="field">
                One-use pairing code
                <input
                  readOnly
                  value={pairing.code}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p className="help">
                Expires {new Date(pairing.expiresAt).toLocaleTimeString()}.
                Generating another code replaces this one. Enter it only at the
                LAN address above.
              </p>
            </div>
          )}
          <p className="help">
            Open an address above on the other device. If it cannot connect,
            check Wi-Fi/Ethernet, the host firewall, and whether your guest
            network isolates devices. Refresh Settings after the host address
            changes.
          </p>
        </>
      )}
      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
