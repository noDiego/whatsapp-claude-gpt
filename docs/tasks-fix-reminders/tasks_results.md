# Tasks Results — Fix resiliencia de Reminders ante "detached Frame"

## Task 01 — Tracking persistente de error fatal en el ReminderManager

**Fecha:** 2026-06-30

**Archivos modificados:**
- `src/services/reminder-service.ts` — Añadido `fatalErrorReminders: Set<string>`, `isFatalPuppeteerError()`, `clearFatalErrors()`, skip en `checkReminders`, catch con detección fatal.
- `tests/reminder-fatal.test.ts` (nuevo) — Tests del detector de errores fatales y de `clearFatalErrors`.

**Validaciones ejecutadas:**

| Validación | Comando | Resultado |
|---|---|---|
| Build | `npm run build` | ✅ Pasó |
| Tests | `env SPEECH_PROVIDER=OPENAI npm test` | ✅ 77/77 tests pasan (12 nuevos) |
| Typecheck strict | `npm run typecheck:strict` | ❌ Falla por deuda preexistente (baseline). Sin errores nuevos en `reminder-service.ts` atribuibles a esta tarea. |

**Resultado:** Implementado según plan. El `Set` no se limpia dentro de `checkReminders`, el skip ocurre inmediatamente después del guard `scheduledDate > now`, el catch genera un solo `[FATAL]` por reminder, y `clearFatalErrors()` está expuesto como método público para que Task 03 lo cablee en el evento `ready`.

**Riesgos restantes:**
- El reseteo del set depende de que Task 03 cablee `clearFatalErrors()` en el evento `ready`. Hasta entonces, el set solo se vacía con reinicio del proceso (estrictamente mejor que el estado actual sin tracking).
- Falsos positivos del detector: patrones específicos de Puppeteer; riesgo bajo.
- Reminder borrado/editado durante caída: ID huérfano en el set, inocuo, se limpia con `clearFatalErrors()`.

**Desviaciones respecto a la task:** Ninguna.

**Decisiones pendientes:**
- Reseteo del set: la task lo marca como "pendiente de confirmar". Se implementó `clearFatalErrors()` según la recomendación del plan (reseteo en `ready` vía Task 03). Sin acoplamiento directo con `connection-service`.

---

## Task 02 — Watchdog de conexión + auto‑reconexión

**Fecha:** 2026-06-30

**Archivos modificados:**
- `src/services/connection-service.ts` (nuevo) — `ConnectionManager` con probe periódico (`getState()`), reconexión (`destroy()`+`initialize()`), mutex, backoff exponencial con jitter, y `failAndExit()` opt‑in.
- `src/config/index.ts` — 5 nuevas entradas en `BotConfig`: `watchdogEnabled`, `watchdogIntervalSec`, `reconnectBaseDelaySec`, `reconnectMaxDelaySec`, `reconnectMaxAttempts`.
- `.env.example` — Documentación de las 5 nuevas env vars.

**Validaciones ejecutadas:**

| Validación | Comando | Resultado |
|---|---|---|
| Build | `npm run build` | ✅ Pasó |
| Tests | `env SPEECH_PROVIDER=OPENAI npm test` | ✅ 77/77 tests pasan (sin cambios, 0 tests nuevos para este módulo) |
| Typecheck strict | `npm run typecheck:strict` | ❌ Falla por deuda preexistente (baseline). Sin errores nuevos en `connection-service.ts` ni en mis líneas de `config/index.ts`. |

**Smoke test manual:** No ejecutado (requiere Task 03 para cablear `startWatchdog()` en `index.ts` y matar Chromium).

**Resultado:** Implementado según plan. Watchdog con probe vía `getState()`: si lanza → reconexión; si `!= CONNECTED` sin lanzar → solo log (respeta QR/pairing). Reconexión con mutex `isReconnecting`, backoff exponencial con jitter 0–50%, cap en `RECONNECT_MAX_DELAY_SEC`. Default `RECONNECT_MAX_ATTEMPTS=0` = in‑process infinito (sin `process.exit`); `>0` habilita `failAndExit()` con cierre ordenado + `process.exit(1)`.

**Riesgos restantes:**
- [SUPUESTO‑PROBE]: El modo de fallo real ("detached Frame") debe hacer que `getState()` lance. Verificado por código (`Client.js:1976-1980`, `pupPage.evaluate`), no empíricamente. Validar con smoke test matando Chromium.
- [SUPUESTO‑REUSE]: `destroy()`+`initialize()` debe reusar limpio la sesión LocalAuth. Verificado por código (`Client.js:1278-1285`, `Client.js:434-510`), no en runtime. Validar con smoke test.
- Logout manual (post_logout): `getState()` probablemente lanza → reconecta → muestra QR. Esperado; el log lo distingue.

**Desviaciones respecto a la task:** Ninguna.

**Decisiones pendientes:**
- [SUPUESTO‑PROBE] y [SUPUESTO‑REUSE] deben validarse en runtime. Pendiente de smoke test.
- Cableado en `index.ts` (Task 03): este módulo expone `startWatchdog()`/`stopWatchdog()` pero no se auto‑inicia. Task 03 lo cableará en el evento `ready`.

---

## Task 03 — Cableado en index.ts (watchdog + reseteo del set fatal)

**Fecha:** 2026-06-30

**Archivos modificados:**
- `src/index.ts` — Import de `ConnectionManager`, cableado de `clearFatalErrors()` + `startWatchdog()` en `ready`, handler `disconnected` (solo log), `stopWatchdog()` en `shutdown` y `uncaughtException`.

**Validaciones ejecutadas:**

| Validación | Comando | Resultado |
|---|---|---|
| Build | `npm run build` | ✅ Pasó |
| Tests | `env SPEECH_PROVIDER=OPENAI npm test` | ✅ 77/77 tests pasan |
| Typecheck strict | `npm run typecheck:strict` | ❌ Falla por deuda preexistente (baseline). Sin errores nuevos en `src/index.ts`. |

**Smoke test manual:** No ejecutado (requiere entorno con WhatsApp Web autenticado y Chromium corriendo). Las tres tasks juntas están listas para smoke test end‑to‑end.

**Resultado:** Implementado según plan. El evento `ready` ahora ejecuta tres efectos idempotentes: `startReminderChecker()`, `clearFatalErrors()`, y `startWatchdog()`. Se agregó handler `disconnected` que solo loguea (la reconexión la maneja el watchdog). `shutdown` y `uncaughtException` paran el watchdog antes de destruir el cliente para evitar reconexiones durante el apagado.

**Riesgos restantes:**
- [SUPUESTO‑PROBE] y [SUPUESTO‑REUSE] de Task 02 siguen pendientes de validación empírica vía smoke test.
- El handler `disconnected` con `reason='LOGOUT'` causará que el watchdog reconecte y muestre QR (sesión borrada). Es esperado.
- Desconexión antes del primer `ready`: el watchdog aún no corre. Fuera de scope de este fix.

**Desviaciones respecto a la task:** Ninguna.

**Decisiones pendientes:**
- [SUPUESTO‑PROBE] y [SUPUESTO‑REUSE] deben validarse en runtime con smoke test end‑to‑end.
