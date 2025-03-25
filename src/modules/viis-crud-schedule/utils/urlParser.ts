export function parseUrl(url: string): string {
    return url.split('?')[0];
}