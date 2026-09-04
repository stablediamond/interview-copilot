// In-process SetWindowDisplayAffinity. PowerShell cannot do this: Windows only
// accepts the call from the process that owns the HWND.
"use strict";

const WDA_NONE = 0x00000000;
const WDA_EXCLUDEFROMCAPTURE = 0x00000011;
const GW_CHILD = 5;
const GW_HWNDNEXT = 2;

/** @type {null | false | { SetWindowDisplayAffinity: Function, GetWindow: Function }} */
let api = undefined;

function load() {
  if (api !== undefined) return api;
  if (process.platform !== "win32") {
    api = null;
    return api;
  }
  try {
    const koffi = require("koffi");
    const user32 = koffi.load("user32.dll");
    api = {
      SetWindowDisplayAffinity: user32.func(
        "bool __stdcall SetWindowDisplayAffinity(void *hWnd, uint32_t dwAffinity)"
      ),
      GetWindow: user32.func("void *__stdcall GetWindow(void *hWnd, uint32_t uCmd)"),
    };
  } catch {
    api = null;
  }
  return api;
}

function hwndFromWindow(win) {
  if (!win || typeof win.getNativeWindowHandle !== "function" || win.isDestroyed?.()) {
    return null;
  }
  const buf = win.getNativeWindowHandle();
  if (!buf || !buf.length) return null;
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

function isNullPtr(p) {
  if (p == null || p === 0 || p === 0n) return true;
  if (typeof p === "object" && typeof p.address === "function") {
    try {
      return p.address() === 0n || p.address() === 0;
    } catch {
      return false;
    }
  }
  return false;
}

function applyToTree(hwnd, affinity, native) {
  if (isNullPtr(hwnd)) return;
  try {
    native.SetWindowDisplayAffinity(hwnd, affinity);
  } catch {
    // ignore per-hwnd failures
  }
  let child = native.GetWindow(hwnd, GW_CHILD);
  while (!isNullPtr(child)) {
    applyToTree(child, affinity, native);
    child = native.GetWindow(child, GW_HWNDNEXT);
  }
}

function setCaptureExcluded(win, excluded) {
  const native = load();
  if (!native) return false;
  const hwnd = hwndFromWindow(win);
  if (hwnd == null) return false;
  applyToTree(hwnd, excluded ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE, native);
  return true;
}

module.exports = { setCaptureExcluded };
