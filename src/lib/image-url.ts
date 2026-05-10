const IMAGE_FILENAME_TIMESTAMP_PATTERN = /^(\d+)-/;

export function getImageVersionFromFilename(filename: string): string {
    return filename.match(IMAGE_FILENAME_TIMESTAMP_PATTERN)?.[1] || filename;
}

export function buildApiImageUrl(filename: string, version?: number | string): string {
    const params = new URLSearchParams({
        imageVersion: String(version ?? getImageVersionFromFilename(filename))
    });

    return `/api/image/${encodeURIComponent(filename)}?${params.toString()}`;
}
