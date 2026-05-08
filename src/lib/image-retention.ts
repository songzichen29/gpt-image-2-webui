export const SERVER_IMAGE_CLEANUP_TIMEZONE_OFFSET_MINUTES = 8 * 60;
export const SERVER_IMAGE_DAILY_CLEANUP_HOUR = 3;

type RetentionLocale = 'en' | 'zh';

export type ServerImageExpiryStatus = {
    expiresAt: Date;
    isExpired: boolean;
    remainingMs: number;
    remainingText: string;
};

export function getServerImageExpiryStatus(
    timestamp: number,
    now: number,
    locale: RetentionLocale
): ServerImageExpiryStatus {
    const expiresAt = getNextDailyCleanupTime(timestamp);
    const remainingMs = expiresAt.getTime() - now;

    return {
        expiresAt,
        isExpired: remainingMs <= 0,
        remainingMs,
        remainingText: formatRemainingTime(remainingMs, locale)
    };
}

export function getNextDailyCleanupTime(timestamp: number): Date {
    const cleanupOffsetMs = SERVER_IMAGE_CLEANUP_TIMEZONE_OFFSET_MINUTES * 60 * 1000;
    const localTimestamp = timestamp + cleanupOffsetMs;
    const localDate = new Date(localTimestamp);

    const cleanupLocalTime = new Date(localTimestamp);
    cleanupLocalTime.setUTCHours(SERVER_IMAGE_DAILY_CLEANUP_HOUR, 0, 0, 0);

    if (localDate.getUTCHours() >= SERVER_IMAGE_DAILY_CLEANUP_HOUR) {
        cleanupLocalTime.setUTCDate(cleanupLocalTime.getUTCDate() + 1);
    }

    return new Date(cleanupLocalTime.getTime() - cleanupOffsetMs);
}

function formatRemainingTime(remainingMs: number, locale: RetentionLocale): string {
    const totalMinutes = Math.max(1, Math.ceil(Math.max(0, remainingMs) / 60_000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (locale === 'zh') {
        if (days > 0) {
            return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
        }

        if (hours > 0) {
            return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
        }

        return `${totalMinutes}分钟`;
    }

    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    return `${totalMinutes}m`;
}
