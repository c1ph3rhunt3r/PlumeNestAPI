function parseMasterPlaylist(data) {
    const sources = [];
    if (!data.includes('#EXT-X-STREAM-INF')) {
        return []; // Not a master playlist
    }
    const lines = data.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
            const resolutionMatch = lines[i].match(/RESOLUTION=(\d+x(\d+))/);
            const quality = resolutionMatch && resolutionMatch[2] ? `${resolutionMatch[2]}p` : 'auto';
            const url = lines[i + 1];
            if (url) {
                sources.push({ quality, url });
            }
        }
    }
    return sources;
}

module.exports = { parseMasterPlaylist };