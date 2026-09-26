import AppKit
import Carbon
import Foundation
import Darwin

// No screen content is inspected until the user presses the shortcut or Capture.
let manager = CaptureManager()

// A shortcut only: no key contents are recorded. Chords, mouse clicks, long holds,
// and intervening keys cancel the sequence so normal Option use does not capture.
struct DoubleOptionTap {
    var downAt: Double? = nil
    var firstRelease: Double? = nil
    mutating func cancel() { downAt = nil; firstRelease = nil }
    mutating func flags(_ flags: CGEventFlags, at time: Double) -> Bool {
        let modifiers = flags.intersection([.maskAlternate, .maskCommand, .maskControl, .maskShift])
        if modifiers == .maskAlternate {
            if downAt == nil { downAt = time }
        } else if modifiers.isEmpty, let down = downAt {
            downAt = nil
            guard time - down <= 0.25 else { cancel(); return false }
            if let first = firstRelease, time - first <= 0.4 { cancel(); return true }
            firstRelease = time
        } else { cancel() }
        return false
    }
}

final class CaptureManager: NSObject {
    let fm = FileManager.default
    var directory = ""
    var lockFD: Int32 = -1
    var hotkey: EventHotKeyRef?
    var eventHandler: EventHandlerRef?
    var statusItem: NSStatusItem?
    var busy = false
    var lastRequest: Double = 0
    var signature = ""
    var target: [String: Any]?
    var process: Process?
    var emptyTicks = 0
    var optionTap = DoubleOptionTap()
    var eventTap: CFMachPort?
    var tapSource: CFRunLoopSource?
    var askedForMonitoring = false
    var askedForRecording = false
    let startedAt = ISO8601DateFormatter().string(from: Date())

    func stopMonitoring() {
        if let source = tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap = eventTap { CFMachPortInvalidate(tap) }
        eventTap = nil; tapSource = nil; optionTap.cancel()
    }
    func monitorOption() -> Bool {
        if eventTap != nil { return true }
        guard CGPreflightListenEventAccess() else {
            if !askedForMonitoring { askedForMonitoring = true; _ = CGRequestListenEventAccess() }
            state("input-monitoring-required", "Double-tap Option needs Input Monitoring permission for Workboard Capture in macOS Settings. Menu capture remains available.")
            return false
        }
        let mask = [CGEventType.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown].reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, _ in
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap = manager.eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
                manager.optionTap.cancel()
            } else if type == .flagsChanged {
                if manager.optionTap.flags(event.flags, at: ProcessInfo.processInfo.systemUptime) { DispatchQueue.main.async { manager.trigger() } }
            } else { manager.optionTap.cancel() }
            return Unmanaged.passUnretained(event)
        }, userInfo: nil) else {
            state("input-monitoring-required", "Unable to listen for Option. Check Input Monitoring permission and restart Workboard Capture."); return false
        }
        eventTap = tap
        tapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), tapSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    // Every status carries the live permission picture, so the board can point
    // at the exact System Settings pane and say whether a relaunch is needed.
    func state(_ value: String, _ message: String) {
        let object: [String: Any] = ["state": value, "message": message, "pid": ProcessInfo.processInfo.processIdentifier, "at": ISO8601DateFormatter().string(from: Date()), "screenRecording": CGPreflightScreenCaptureAccess(), "inputMonitoring": CGPreflightListenEventAccess(), "startedAt": startedAt]
        let file = URL(fileURLWithPath: directory).appendingPathComponent("status.json")
        if let data = try? JSONSerialization.data(withJSONObject: object) {
            do { try data.write(to: file, options: .atomic) } catch { fputs("Could not write status: \(error)\n", stderr) }
        }
        statusItem?.button?.toolTip = message
    }
    func readyState(_ message: String) {
        if CGPreflightScreenCaptureAccess() { state("ready", message) }
        else { state("screen-recording-required", "\(message). Screen Recording permission is not active for this companion: allow Workboard Capture in System Settings, then relaunch the companion.") }
    }
    func projects() -> [[String: Any]] {
        ((try? fm.contentsOfDirectory(atPath: directory)) ?? []).filter { $0.hasPrefix("project-") && $0.hasSuffix(".json") }.compactMap { name in
            guard let data = try? Data(contentsOf: URL(fileURLWithPath: directory).appendingPathComponent(name)), let item = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            guard let number = item["pid"] as? NSNumber else { return nil }
            if kill(number.int32Value, 0) != 0 { try? self.fm.removeItem(atPath: self.directory + "/" + name); return nil }
            return item
        }.sorted { ($0["activeAt"] as? String ?? "") > ($1["activeAt"] as? String ?? "") }
    }
    func start(_ directory: String) {
        self.directory = directory
        try? fm.createDirectory(atPath: directory, withIntermediateDirectories: true)
        lockFD = Darwin.open(directory + "/companion.lock", O_CREAT | O_RDWR, 0o600)
        guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { exit(0) }
        NSApplication.shared.setActivationPolicy(.accessory)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "CR"
        let menu = NSMenu()
        let capture = NSMenuItem(title: "Capture for active project", action: #selector(trigger), keyEquivalent: "")
        capture.target = self; menu.addItem(capture)
        let open = NSMenuItem(title: "Open active project", action: #selector(openProject), keyEquivalent: "")
        open.target = self; menu.addItem(open)
        menu.addItem(NSMenuItem.separator())
        let relaunch = NSMenuItem(title: "Relaunch capture companion", action: #selector(relaunchCompanion), keyEquivalent: "")
        relaunch.target = self; menu.addItem(relaunch)
        let quit = NSMenuItem(title: "Quit capture companion", action: #selector(quitCompanion), keyEquivalent: "")
        quit.target = self; menu.addItem(quit); statusItem?.menu = menu
        if !CGPreflightScreenCaptureAccess() { state("screen-recording-required", "Screen Recording permission is not active for this companion. Allow Workboard Capture in System Settings, then relaunch the companion.") }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ -> OSStatus in
            DispatchQueue.main.async { manager.trigger() }; return noErr
        }, 1, &spec, nil, &eventHandler)
        tick()
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in self.tick() }
        NSApplication.shared.run()
    }
    func tick() {
        let all = projects()
        if all.isEmpty { emptyTicks += 1; if emptyTicks > 8 && !busy { quitCompanion() }; return }
        emptyTicks = 0
        if let p = all.first {
            let shortcut = p["shortcut"] as? [String: Any] ?? [:]
            let key = shortcut["key"] as? UInt32 ?? 1
            let modifiers = shortcut["modifiers"] as? UInt32 ?? 6400
            let doubleTap = shortcut["mode"] as? String != "hotkey"
            let next = doubleTap ? "double-alt" : "\(key):\(modifiers)"
            if signature != next {
                if let ref = hotkey { UnregisterEventHotKey(ref); hotkey = nil }
                if doubleTap {
                    if monitorOption() { signature = next; readyState("Double-tap Option to capture for \(p["name"] as? String ?? "project")") }
                } else {
                stopMonitoring()
                var ref: EventHotKeyRef?
                let code = RegisterEventHotKey(key, modifiers, EventHotKeyID(signature: 0x57424F41, id: 1), GetApplicationEventTarget(), 0, &ref)
                if code == noErr { hotkey = ref; signature = next; readyState("Capture ready for \(p["name"] as? String ?? "project")") }
                else { state("shortcut-conflict", "Could not register shortcut (\(code)). Choose another key in Settings. Paste/drop and menu capture remain available.") }
                }
            }
        }
        let requestURL = URL(fileURLWithPath: directory).appendingPathComponent("request.json")
        if let data = try? Data(contentsOf: requestURL), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let at = object["at"] as? Double, at > lastRequest {
            lastRequest = at
            if Date().timeIntervalSince1970 * 1000 - at < 10000 { trigger() }
        }
    }
    @objc func trigger() {
        guard !busy else { return }
        guard let destination = projects().first, let drafts = destination["draftDirectory"] as? String else {
            state("destination-unavailable", "No running project is available. Open a project before capturing."); return
        }
        // Screen Recording is granted per process: a grant made while this
        // companion was already running only applies after a relaunch.
        guard CGPreflightScreenCaptureAccess() else {
            if !askedForRecording { askedForRecording = true; _ = CGRequestScreenCaptureAccess() }
            state("screen-recording-required", "Screen Recording permission is not active for this companion. Allow Workboard Capture under System Settings > Privacy & Security > Screen Recording, then relaunch the companion (Relaunch in Settings or the CR menu).")
            return
        }
        busy = true; target = destination
        try? fm.createDirectory(atPath: drafts, withIntermediateDirectories: true)
        let file = URL(fileURLWithPath: drafts).appendingPathComponent("capture-\(UUID().uuidString).png")
        let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        task.arguments = ["-i", "-x", "-t", "png", file.path]
        let errors = Pipe(); task.standardError = errors
        task.terminationHandler = { process in
            let errorData = errors.fileHandleForReading.readDataToEndOfFile()
            let diagnostic = String(data: errorData, encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                self.process = nil
                guard process.terminationStatus == 0, self.fm.fileExists(atPath: file.path), let data = try? Data(contentsOf: file), !data.isEmpty else {
                    self.busy = false
                    try? self.fm.removeItem(at: file)
                    if diagnostic.lowercased().contains("permission") || diagnostic.lowercased().contains("could not") {
                        self.state("permission-required", "Capture failed. Check macOS Screen Recording permission for Workboard Capture. \(diagnostic)")
                    } else { self.state("cancelled", "Capture cancelled; no attachment was created.") }
                    return
                }
                self.deliver(file, data, destination)
            }
        }
        do { try task.run(); process = task; state("capturing", "Select a region or press Space for a window. Escape cancels.") }
        catch { busy = false; state("error", "Could not start screen capture: \(error.localizedDescription)") }
    }
    func deliver(_ file: URL, _ data: Data, _ destination: [String: Any]) {
        guard let base = destination["url"] as? String, base.hasPrefix("http://127.0.0.1:"), let url = URL(string: base + "/api/images"), let token = destination["token"] as? String else { busy = false; state("draft-retained", "Destination unavailable; screenshot draft retained at \(file.path)"); return }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["name": "Screenshot \(ISO8601DateFormatter().string(from: Date()))", "data": data.base64EncodedString()])
        URLSession.shared.dataTask(with: request) { payload, response, error in
            DispatchQueue.main.async {
                self.busy = false
                guard error == nil, let http = response as? HTTPURLResponse, http.statusCode == 200, let payload = payload, let result = try? JSONSerialization.jsonObject(with: payload) as? [String: Any], let id = result["id"] as? String else {
                    self.state("draft-retained", "Project unavailable. Draft retained at \(file.path); recover it from project Settings."); return
                }
                try? self.fm.removeItem(at: file)
                self.state("ready", "Screenshot sent to \(destination["name"] as? String ?? "project")")
                if let editor = URL(string: base + "/#image=" + id) { NSWorkspace.shared.open(editor) }
            }
        }.resume()
    }
    @objc func openProject() { if let p = projects().first, let address = p["url"] as? String, let url = URL(string: address) { NSWorkspace.shared.open(url) } }
    // Picks up permission changes: a fresh process gets the current grants.
    @objc func relaunchCompanion() {
        let bundle = Bundle.main.bundleURL
        let task = Process(); task.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        task.arguments = ["-g", "-n", bundle.path, "--args", directory]
        stopMonitoring(); if let ref = hotkey { UnregisterEventHotKey(ref) }
        if lockFD >= 0 { flock(lockFD, LOCK_UN); close(lockFD); lockFD = -1 }
        state("restarting", "Capture companion is relaunching")
        try? task.run()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSApplication.shared.terminate(nil) }
    }
    @objc func quitCompanion() { stopMonitoring(); if let ref = hotkey { UnregisterEventHotKey(ref) }; state("not-running", "Capture companion stopped"); if lockFD >= 0 { flock(lockFD, LOCK_UN); close(lockFD) }; NSApplication.shared.terminate(nil) }
}

if CommandLine.arguments.contains("--self-test") {
    var detector = DoubleOptionTap()
    precondition(!detector.flags(.maskAlternate, at: 0))
    precondition(!detector.flags([], at: 0.05))
    precondition(!detector.flags(.maskAlternate, at: 0.15))
    precondition(detector.flags([], at: 0.2))
    precondition(!detector.flags(.maskAlternate, at: 1))
    detector.cancel()
    precondition(!detector.flags([], at: 1.05))
    precondition(!detector.flags(.maskAlternate, at: 1.15))
    precondition(!detector.flags([], at: 1.2))
    detector.cancel()
    precondition(!detector.flags(.maskAlternate, at: 2))
    precondition(!detector.flags([], at: 3))
    print("Double Option detector: tap sequence, intervening key, and long-hold checks passed")
    var reference: EventHotKeyRef?
    let result = RegisterEventHotKey(1, 6400, EventHotKeyID(signature: 0x57425453, id: 99), GetApplicationEventTarget(), 0, &reference)
    if let reference = reference { UnregisterEventHotKey(reference) }
    print("Hotkey registration status: \(result); capture executable present: \(FileManager.default.isExecutableFile(atPath: "/usr/sbin/screencapture"))")
    exit(result == noErr ? 0 : 1)
}
guard CommandLine.arguments.count > 1 else { fputs("Usage: WorkboardCapture runtime-directory\n", stderr); exit(1) }
manager.start(CommandLine.arguments[1])
