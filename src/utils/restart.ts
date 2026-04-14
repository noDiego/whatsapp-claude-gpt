import logger from '../logger';

let shuttingDown = false;

export function requestAppRestart(reason: string, err?: any) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.error(`[FATAL_RESTART] ${reason}`);
    if (err) {
        logger.error(err.stack || err.message || err);
    }

    setTimeout(() => {
        process.exit(1);
    }, 500);
}