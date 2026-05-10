export const SERVER_IMAGE_RETENTION_DAYS = 1;

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
    const expiresAt = getServerImageExpiryTime(timestamp);
    const remainingMs = expiresAt.getTime() - now;

    return {
        expiresAt,
        isExpired: remainingMs <= 0,
        remainingMs,
        remainingText: formatRemainingTime(remainingMs, locale)
    };
}

export function getServerImageExpiryTime(timestamp: number): Date {
    return new Date(timestamp + SERVER_IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
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
