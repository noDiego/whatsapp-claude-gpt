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
