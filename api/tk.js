// Vercel Serverless Function - logika fetch diambil dari plugin groupveriftt.js (V5)
import crypto from 'node:crypto';
const TIKTOK = 'https://www.tiktok.com';
const TIKWM = 'https://www.tikwm.com/api';
const OEMBED = 'https://www.tiktok.com/oembed';
const REQUEST_TIMEOUT = 15_000;
const PROFILE_TIMEOUT = 12_000;
let TikTokClientCtor = null;
let tiktokClientLoadPromise = null;
function clean(value) {
  return String(value ?? '')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function cleanUrl(value) {
  return String(value || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/["'`]+$/g, '')
    .replace(/[),.;]+$/g, '');
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[\s,._]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function fmtNum(value) {
  const n = num(value);
  if (n === null) return '-';
  try {
    return new Intl.NumberFormat('id-ID', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(n);
  } catch {
    return String(n);
  }
}

function fmtInt(value) {
  const n = num(value);
  if (n === null) return '-';
  try {
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.trunc(n));
  }
}

function fmtDate(value) {
  const n = num(value);
  if (!n) return '-';
  try {
    const d = new Date(n > 1e12 ? n : n * 1000);
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Jakarta'
    }).format(d);
  } catch {
    return '-';
  }
}

function unique(items) {
  return [...new Set((items || []).map(cleanUrl).filter(Boolean))];
}

function getValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizeJid(value) {
  let s = String(value || '').trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  if (s.includes(':')) s = s.split(':')[0];
  if (s.endsWith('@lid')) return s;
  if (s.includes('@')) return s;
  if (/^\d{5,}$/.test(s)) return `${s}@s.whatsapp.net`;
  return s;
}

function jidNumber(jid) {
  return String(jid || '')
    .replace(/:\d+/, '')
    .split('@')[0]
    .replace(/\D/g, '');
}

function makeShortId() {
  return crypto.randomBytes(4).toString('hex').slice(0, 6);
}

function isGroupJid(jid) {
  return String(jid || '').endsWith('@g.us');
}

function isTikTokHost(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return h === 'tiktok.com' || h.endsWith('.tiktok.com');
}
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const response = await fetchWithTimeout(url, options, timeout);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = safeJsonParse(text, null);
  if (!data) throw new Error('Respons bukan JSON yang valid.');
  return data;
}

function pickAuthor(raw) {
  const author = raw?.author || raw?.authorMeta || raw?.authorInfo || raw?.user || {};
  return {
    uniqueId: clean(getValue(author.uniqueId, author.unique_id, author.username, raw?.uniqueId, raw?.unique_id, ''))
      .replace(/^@/, ''),
    nickname: clean(getValue(author.nickname, author.name, raw?.nickname, raw?.authorName, '')),
    signature: clean(getValue(author.signature, raw?.signature, '')),
    avatar: clean(getValue(
      author.avatarLarger,
      author.avatarMedium,
      author.avatarThumb,
      author.avatar,
      author.avatar_url,
      raw?.avatarLarger,
      raw?.avatarMedium,
      raw?.avatarThumb,
      raw?.avatar,
      ''
    )),
    id: clean(getValue(author.id, author.uid, author.userId, '')),
    verified: Boolean(author.verified || author.isVerified || author.is_verified),
    privateAccount: Boolean(author.privateAccount ?? author.private_account ?? author.secret)
  };
}

function extractImages(raw) {
  const out = [];
  const visit = value => {
    if (!value) return;
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) out.push(cleanUrl(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'object') {
      for (const key of [
        'urlList', 'url_list', 'url_list_v2', 'url', 'uri',
        'imageURL', 'image_url', 'displayImage', 'display_image'
      ]) {
        if (value[key]) visit(value[key]);
      }
    }
  };

  for (const source of [
    raw?.images,
    raw?.image_post_info?.images,
    raw?.imagePost?.images,
    raw?.imagePost?.imageList,
    raw?.image_list,
    raw?.imageInfos
  ]) visit(source);

  return unique(out);
}

function pickMusic(raw) {
  const music = raw?.music_info || raw?.musicInfo || raw?.music || {};
  return {
    title: clean(getValue(music.title, music.name, raw?.music_name, raw?.musicName, '')),
    author: clean(getValue(music.author, music.authorName, music.author_name, '')),
    url: cleanUrl(getValue(music.play, music.playUrl, music.url, music.play_url, '')),
    duration: num(getValue(music.duration, raw?.music_duration, null)),
    original: Boolean(music.original)
  };
}

function normalizePost(payload, originalUrl) {
  const data = payload?.data || payload;
  if (!data || typeof data !== 'object') throw new Error('Data TikTok kosong.');

  const author = pickAuthor(data);
  const stats = data.statistics || data.stats || data.statsV2 || {};
  const video = data.video || {};
  const images = extractImages(data);
  const music = pickMusic(data);

  const id = clean(getValue(
    data.id,
    data.video_id,
    data.item_id,
    data.aweme_id,
    data.awemeId,
    ''
  ));

  const username = author.uniqueId || clean(getValue(
    data.unique_id,
    data.uniqueId,
    data.username,
    data.uploader,
    ''
  )).replace(/^@/, '');

  const caption = clean(getValue(
    data.title,
    data.desc,
    data.description,
    data.caption,
    ''
  ));

  const tags = [];
  for (const source of [data.hashtags, data.challengeInfo, data.challenges, data.textExtra]) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const value = typeof item === 'string'
        ? item
        : getValue(item?.title, item?.name, item?.hashtagName, item?.hashtag_name, item?.challengeName, '');
      if (value) tags.push(String(value).startsWith('#') ? String(value) : `#${value}`);
    }
  }

  const hashtags = unique([...tags, ...extractHashtags(caption)]);
  const videoUrl = cleanUrl(getValue(
    data.hdplay,
    data.play,
    data.play_url,
    data.playUrl,
    data.playAddr,
    data.play_addr,
    data.downloadAddr,
    data.download_addr,
    video.hdplay,
    video.play,
    video.playUrl,
    video.playAddr,
    video.play_addr,
    video.downloadAddr,
    video.download_addr,
    ''
  ));

  const postUrl = cleanUrl(getValue(
    data.share_url,
    data.shareUrl,
    data.webpage_url,
    data.webpageUrl,
    username && id ? `${TIKTOK}/@${username}/video/${id}` : '',
    originalUrl
  ));

  const isImagePost = images.length > 0 && !videoUrl;

  return {
    id,
    username,
    nickname: author.nickname,
    caption,
    hashtags,
    views: num(getValue(data.play_count, data.playCount, data.view_count, data.viewCount, stats.play_count, stats.playCount, null)),
    likes: num(getValue(data.digg_count, data.diggCount, data.like_count, data.likeCount, stats.digg_count, stats.diggCount, null)),
    comments: num(getValue(data.comment_count, data.commentCount, stats.comment_count, stats.commentCount, null)),
    shares: num(getValue(data.share_count, data.shareCount, stats.share_count, stats.shareCount, null)),
    favorites: num(getValue(
      data.collect_count,
      data.collectCount,
      data.favorite_count,
      data.favoriteCount,
      data.favorites_count,
      data.favoritesCount,
      stats.collect_count,
      stats.collectCount,
      stats.favorite_count,
      stats.favoriteCount,
      null
    )),
    reposts: num(getValue(data.repost_count, data.repostCount, stats.repost_count, stats.repostCount, null)),
    downloads: num(getValue(data.download_count, data.downloadCount, stats.download_count, stats.downloadCount, null)),
    createTime: getValue(data.create_time, data.createTime, data.timestamp, null),
    duration: num(getValue(data.duration, data.video_duration, video.duration, null)),
    cover: cleanUrl(getValue(data.origin_cover, data.originCover, data.cover, data.thumbnail, '')),
    avatar: author.avatar,
    verified: author.verified,
    privateAccount: author.privateAccount,
    videoUrl,
    images,
    imageCount: images.length,
    isImagePost,
    music,
    url: postUrl,
    raw: data
  };
}

function postQuality(post) {
  let score = 0;
  if (post?.id) score += 15;
  if (post?.username) score += 10;
  if (post?.nickname) score += 5;
  if (post?.caption !== '') score += 10;
  if (post?.hashtags?.length) score += 5;
  if (post?.likes !== null) score += 8;
  if (post?.comments !== null) score += 8;
  if (post?.shares !== null) score += 7;
  if (post?.favorites !== null) score += 5;
  if (post?.videoUrl || post?.images?.length) score += 15;
  if (post?.music?.title || post?.music?.url) score += 4;
  return score;
}

async function loadTikTokClient() {
  if (tiktokClientLoadPromise) return tiktokClientLoadPromise;
  tiktokClientLoadPromise = (async () => {
    try {
      const mod = await import('@ssut/tiktok-api');
      TikTokClientCtor = mod.TikTokClient || mod.default?.TikTokClient || mod.default;
      if (typeof TikTokClientCtor !== 'function') {
        throw new Error('TikTokClient tidak ditemukan dari @ssut/tiktok-api.');
      }
      return TikTokClientCtor;
    } catch (error) {
      throw new Error(`@ssut/tiktok-api tidak siap: ${error?.message || error}`);
    }
  })();
  return tiktokClientLoadPromise;
}

function makeTikTokClient() {
  if (typeof TikTokClientCtor !== 'function') {
    throw new Error('TikTokClient belum dimuat.');
  }
  return new TikTokClientCtor({ region: 'US' });
}

function profileFromPayload(payload, fallbackUsername = '', fallbackPost = null) {
  const root = payload?.data || payload || {};
  const userInfo = root?.userInfo || payload?.userInfo || {};
  const user = userInfo?.user || root?.user || {};
  const fallbackRaw = fallbackPost?.raw || {};
  const rawAuthor =
    fallbackRaw?.author ||
    fallbackRaw?.authorMeta ||
    fallbackRaw?.authorInfo ||
    fallbackRaw?.user ||
    {};

  const stats =
    userInfo?.stats ||
    root?.stats ||
    root?.statsV2 ||
    root?.authorStats ||
    root?.author_stats ||
    fallbackRaw?.authorStats ||
    fallbackRaw?.author_stats ||
    rawAuthor?.stats ||
    rawAuthor?.statistics ||
    {};

  const uniqueId = clean(getValue(
    user.uniqueId,
    user.unique_id,
    user.username,
    rawAuthor.uniqueId,
    rawAuthor.unique_id,
    rawAuthor.username,
    fallbackPost?.username,
    fallbackUsername,
    ''
  )).replace(/^@/, '');

  const nickname = clean(getValue(
    user.nickname,
    user.name,
    rawAuthor.nickname,
    rawAuthor.name,
    fallbackPost?.nickname,
    ''
  ));

  const signature = clean(getValue(
    user.signature,
    user.bioDescription,
    user.bio_description,
    user.description,
    rawAuthor.signature,
    rawAuthor.bioDescription,
    rawAuthor.bio_description,
    rawAuthor.description,
    fallbackRaw?.signature,
    fallbackPost?.signature,
    ''
  ));

  const avatar = cleanUrl(getValue(
    user.avatarLarger,
    user.avatar_large,
    user.avatarMedium,
    user.avatar_medium,
    user.avatarThumb,
    user.avatar_thumb,
    user.avatar,
    user.avatar_url,
    rawAuthor.avatarLarger,
    rawAuthor.avatar_large,
    rawAuthor.avatarMedium,
    rawAuthor.avatar_medium,
    rawAuthor.avatarThumb,
    rawAuthor.avatar_thumb,
    rawAuthor.avatar,
    rawAuthor.avatar_url,
    fallbackPost?.avatar,
    ''
  ));

  const profile = {
    uniqueId,
    nickname,
    signature,
    avatar,
    followers: num(getValue(
      stats.followerCount,
      stats.follower_count,
      stats.followers,
      user.followerCount,
      user.follower_count,
      rawAuthor.followerCount,
      rawAuthor.follower_count,
      null
    )),
    following: num(getValue(
      stats.followingCount,
      stats.following_count,
      stats.following,
      user.followingCount,
      user.following_count,
      rawAuthor.followingCount,
      rawAuthor.following_count,
      null
    )),
    likes: num(getValue(
      stats.heartCount,
      stats.heart_count,
      stats.heart,
      stats.likesCount,
      stats.likes_count,
      user.heartCount,
      user.heart_count,
      user.likesCount,
      user.likes_count,
      rawAuthor.heartCount,
      rawAuthor.heart_count,
      null
    )),
    // Disimpan untuk kompatibilitas database/merge lama, tetapi TIDAK ditampilkan
    // pada hasil verifikasi sesuai permintaan pengguna.
    videos: num(getValue(
      stats.videoCount,
      stats.video_count,
      user.videoCount,
      user.video_count,
      rawAuthor.videoCount,
      rawAuthor.video_count,
      null
    )),
    verified: Boolean(
      user.verified ??
      user.isVerified ??
      user.is_verified ??
      rawAuthor.verified ??
      rawAuthor.isVerified ??
      rawAuthor.is_verified ??
      fallbackPost?.verified
    ),
    privateAccount: Boolean(
      user.privateAccount ??
      user.private_account ??
      user.secret ??
      rawAuthor.privateAccount ??
      rawAuthor.private_account ??
      rawAuthor.secret ??
      fallbackPost?.privateAccount
    ),
    raw: payload || null
  };

  const hasMeaningfulData = Boolean(
    profile.uniqueId ||
    profile.nickname ||
    profile.signature ||
    profile.avatar ||
    profile.followers !== null ||
    profile.following !== null ||
    profile.likes !== null
  );

  return hasMeaningfulData ? profile : null;
}

function mergeProfile(...profiles) {
  const list = profiles
    .filter(Boolean)
    .sort((a, b) => {
      const score = item => {
        let n = 0;
        for (const key of ['uniqueId', 'nickname', 'signature', 'avatar', 'followers', 'following', 'likes']) {
          const v = item?.[key];
          if (v !== null && v !== undefined && v !== '') n += 1;
        }
        return n;
      };
      return score(b) - score(a);
    });

  if (!list.length) return null;

  const base = { ...list[0] };
  for (const item of list.slice(1)) {
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null || value === '') continue;
      if (base[key] === undefined || base[key] === null || base[key] === '') {
        base[key] = value;
      }
    }
  }
  return base;
}

function extractScriptJson(html, scriptId) {
  const id = String(scriptId || '');
  const regex =
    id === '__UNIVERSAL_DATA_FOR_REHYDRATION__'
      ? /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i
      : id === 'SIGI_STATE'
        ? /<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i
        : null;
  if (!regex) return null;
  const match = String(html || '').match(regex);
  if (!match) return null;
  return safeJsonParse(match[1].trim(), null);
}

function deepFindProfileNode(root, wantedUsername = '') {
  if (!root || typeof root !== 'object') return null;

  const wanted = String(wantedUsername || '').replace(/^@/, '').toLowerCase();
  const stack = [root];
  const seen = new Set();
  let visited = 0;
  let best = null;
  let bestScore = -1;

  while (stack.length && visited < 180000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    visited += 1;

    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }

    const nestedUser = value.user && typeof value.user === 'object' ? value.user : null;
    const candidate = nestedUser || value;
    const uniqueId = clean(getValue(
      candidate.uniqueId,
      candidate.unique_id,
      candidate.username,
      candidate.handle,
      ''
    )).replace(/^@/, '');
    const nickname = clean(getValue(candidate.nickname, candidate.name, ''));
    const signature = clean(getValue(
      candidate.signature,
      candidate.bioDescription,
      candidate.bio_description,
      candidate.description,
      ''
    ));
    const hasStats = Boolean(
      value.stats ||
      value.statsV2 ||
      value.authorStats ||
      value.author_stats ||
      candidate.followerCount !== undefined ||
      candidate.followingCount !== undefined ||
      candidate.heartCount !== undefined ||
      candidate.likesCount !== undefined
    );

    if (uniqueId || nickname || signature) {
      let score = 0;
      if (wanted && uniqueId.toLowerCase() === wanted) score += 40;
      if (uniqueId) score += 10;
      if (nickname) score += 8;
      if (signature) score += 12;
      if (hasStats) score += 20;
      if (candidate.avatarLarger || candidate.avatarMedium || candidate.avatarThumb || candidate.avatar_url) score += 5;

      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') stack.push(child);
    }
  }

  return best;
}

async function fetchTikTokProfilePage(username) {
  const normalized = String(username || '').replace(/^@/, '').trim();
  if (!normalized) return null;

  const url = `${TIKTOK}/@${encodeURIComponent(normalized)}`;
  const { response, text } = await fetchText(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
      'Cache-Control': 'no-cache'
    }
  }, PROFILE_TIMEOUT);

  if (!response.ok) throw new Error(`TikTok profile HTTP ${response.status}`);

  const sets = [
    extractScriptJson(text, '__UNIVERSAL_DATA_FOR_REHYDRATION__'),
    extractScriptJson(text, 'SIGI_STATE')
  ].filter(Boolean);

  for (const data of sets) {
    const node = deepFindProfileNode(data, normalized);
    if (!node) continue;
    const profile = profileFromPayload(node, normalized, null);
    if (profile) return profile;
  }

  return null;
}

async function fetchTikWMProfile(username) {
  const normalized = String(username || '').replace(/^@/, '').trim();
  if (!normalized) return null;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
  };

  let lastError = null;
  const query = new URLSearchParams({ unique_id: normalized }).toString();

  for (const method of ['GET', 'POST']) {
    try {
      const response = method === 'GET'
        ? await fetchWithTimeout(`${TIKWM}/user/info?${query}`, { headers }, PROFILE_TIMEOUT)
        : await fetchWithTimeout(`${TIKWM}/user/info`, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: query
          }, PROFILE_TIMEOUT);

      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = safeJsonParse(text, null);
      if (!data) throw new Error('TikWM profile bukan JSON.');
      if (data?.code != null && Number(data.code) !== 0) {
        throw new Error(data?.msg || `TikWM profile code ${data.code}`);
      }

      const profile = profileFromPayload(data, normalized, null);
      if (profile) return profile;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
}

async function fetchSSUTProfile(username) {
  const normalized = String(username || '').replace(/^@/, '').trim();
  if (!normalized) return null;

  await loadTikTokClient();
  const client = makeTikTokClient();
  const result = await Promise.race([
    client.getUser(normalized),
    new Promise((_, reject) => setTimeout(() => reject(new Error('getUser timeout.')), PROFILE_TIMEOUT))
  ]);

  const profile = profileFromPayload(result, normalized, null);
  if (!profile) throw new Error('getUser tidak menghasilkan profil.');
  return profile;
}

async function fetchTikTokProfile(username, fallbackPost = null) {
  const normalized = String(username || fallbackPost?.username || '').replace(/^@/, '').trim();
  if (!normalized && !fallbackPost) return null;

  const seed = profileFromPayload(fallbackPost?.raw || {}, normalized, fallbackPost);
  const jobs = [
    fetchSSUTProfile(normalized),
    fetchTikWMProfile(normalized),
    fetchTikTokProfilePage(normalized)
  ];

  const settled = await Promise.allSettled(jobs);
  const remoteProfiles = settled
    .filter(x => x.status === 'fulfilled' && x.value)
    .map(x => x.value);

  const merged = mergeProfile(seed, ...remoteProfiles);
  if (merged) return merged;

  // Jangan mengarang nilai profile. Fallback minimal hanya mempertahankan username
  // yang memang sudah dibaca dari VT.
  if (normalized) {
    return {
      uniqueId: normalized,
      nickname: fallbackPost?.nickname || '',
      signature: '',
      avatar: fallbackPost?.avatar || '',
      followers: null,
      following: null,
      likes: null,
      videos: null,
      verified: Boolean(fallbackPost?.verified),
      privateAccount: Boolean(fallbackPost?.privateAccount),
      raw: null
    };
  }

  return null;
}

function mergePost(...posts) {
  const list = posts.filter(Boolean).sort((a, b) => postQuality(b) - postQuality(a));
  const base = { ...(list[0] || {}) };
  for (const post of list.slice(1)) {
    for (const [key, value] of Object.entries(post)) {
      if (base[key] === undefined || base[key] === null || base[key] === '') base[key] = value;
    }
  }
  base.hashtags = [...new Map(
    list.flatMap(p => Array.isArray(p.hashtags) ? p.hashtags : [])
      .map(tag => [String(tag).toLowerCase(), tag])
  ).values()];
  if (!base.hashtags.length) base.hashtags = extractHashtags(base.caption || '');
  base.images = list.find(p => Array.isArray(p.images) && p.images.length)?.images || base.images || [];
  base.music = list.find(p => p.music?.url || p.music?.title)?.music || base.music || { title: '', author: '', url: '', duration: null, original: false };
  return base;
}

async function fetchTikWMPost(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
  };

  let lastError = null;
  for (const endpoint of [`${TIKWM}/`, TIKWM]) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: new URLSearchParams({
          url: cleanUrl(url),
          hd: '1'
        }).toString()
      });
      const text = await response.text();
      const data = safeJsonParse(text, null);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!data) throw new Error('TikWM POST bukan JSON.');
      if (Number(data.code) !== 0) throw new Error(data.msg || `TikWM code ${data.code}`);
      const post = normalizePost(data, url);
      if (!post.id && !post.username && !post.videoUrl && !post.images.length) throw new Error('TikWM POST tidak mengembalikan data VT.');
      return post;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const data = await fetchJson(`${TIKWM}?${new URLSearchParams({ url: cleanUrl(url), hd: '1' }).toString()}`, {
      headers
    });
    if (Number(data?.code) !== 0) throw new Error(data?.msg || `TikWM code ${data?.code}`);
    return normalizePost(data, url);
  } catch (error) {
    lastError = error;
  }

  throw new Error(`TikTok gagal dibaca: ${lastError?.message || 'sumber tidak tersedia'}`);
}

function extractTikTokItemIdFromUrl(rawUrl) {
  try {
    const url = new URL(cleanUrl(rawUrl));
    if (!isTikTokHost(url.hostname)) return '';
    const pathMatch = url.pathname.match(/\/(?:video|photo)\/(\d{8,})/i);
    if (pathMatch) return pathMatch[1];
    for (const key of ['item_id', 'itemId', 'aweme_id', 'awemeId', 'video_id']) {
      const value = url.searchParams.get(key);
      if (/^\d{8,}$/.test(String(value || ''))) return String(value);
    }
    const numeric = url.pathname.split('/').find(part => /^\d{8,}$/.test(part));
    return numeric || '';
  } catch {
    return '';
  }
}

async function resolveTikTokShortUrl(rawUrl) {
  const input = cleanUrl(rawUrl);
  try {
    const response = await fetchWithTimeout(input, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }, 8000);
    const finalUrl = cleanUrl(response.url || input);
    try { await response.body?.cancel(); } catch {}
    return finalUrl || input;
  } catch {
    return input;
  }
}

function findSSUTPostObject(root, preferredId = '') {
  if (!root || typeof root !== 'object') return null;
  const wanted = String(preferredId || '');
  const direct = [
    root?.data?.itemInfo?.itemStruct,
    root?.data?.itemInfo,
    root?.data?.itemStruct,
    root?.itemInfo?.itemStruct,
    root?.itemStruct,
    root?.data?.aweme_detail,
    root?.aweme_detail,
    root?.data?.awemeDetail,
    root?.awemeDetail,
    root?.data?.post
  ];
  const getId = value => String(
    value?.id ?? value?.itemId ?? value?.item_id ?? value?.awemeId ?? value?.aweme_id ?? value?.video_id ?? ''
  );
  for (const candidate of direct) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (/^\d{8,}$/.test(getId(candidate)) && (!wanted || getId(candidate) === wanted)) return candidate;
  }

  const stack = [root];
  const seen = new Set();
  let fallback = null;
  let visited = 0;
  while (stack.length && visited < 120000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    visited++;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === 'object') stack.push(child);
      continue;
    }
    const id = getId(value);
    const hasContent = typeof value.desc === 'string' || typeof value.description === 'string' ||
      typeof value.title === 'string' || Boolean(value.author || value.authorMeta || value.authorInfo || value.statistics || value.stats || value.video || value.imagePost || value.image_post_info);
    if (/^\d{8,}$/.test(id) && hasContent) {
      if (wanted && id === wanted) return value;
      fallback ||= value;
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
  }
  return fallback;
}

async function fetchSSUTPost(rawUrl) {
  let resolvedUrl = cleanUrl(rawUrl);
  let videoId = extractTikTokItemIdFromUrl(resolvedUrl);
  if (!videoId) {
    resolvedUrl = await resolveTikTokShortUrl(resolvedUrl);
    videoId = extractTikTokItemIdFromUrl(resolvedUrl);
  }
  if (!videoId) throw new Error('URL pendek belum berhasil diarahkan ke ID VT sehingga getPost tidak bisa dipanggil.');

  await loadTikTokClient();
  const client = makeTikTokClient();
  const result = await Promise.race([
    client.getPost(videoId),
    new Promise((_, reject) => setTimeout(() => reject(new Error('TikTokClient.getPost timeout (12 detik).')), 12000))
  ]);
  const rawPost = findSSUTPostObject(result, videoId);
  if (!rawPost) throw new Error('@ssut/tiktok-api getPost tidak memberikan objek VT yang dikenali.');

  const post = normalizePost(rawPost, resolvedUrl || rawUrl);
  if (!post.id) post.id = videoId;
  if (!post.url && post.username && post.id) post.url = `${TIKTOK}/@${post.username}/video/${post.id}`;
  if (!post.username && resolvedUrl) {
    try {
      const parsed = new URL(resolvedUrl);
      const authorPart = parsed.pathname.split('/').find(part => part.startsWith('@'));
      if (authorPart) post.username = decodeURIComponent(authorPart.slice(1));
    } catch {}
  }
  if (postQuality(post) < 20) throw new Error('@ssut/tiktok-api metadata VT terlalu minim.');
  return post;
}

async function fetchOEmbed(url) {
  const endpoint = `${OEMBED}?${new URLSearchParams({ url: cleanUrl(url) }).toString()}`;
  return fetchJson(endpoint, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  }, REQUEST_TIMEOUT);
}

function enrichFromOEmbed(post, data) {
  if (!post || !data) return post;
  const authorUrl = cleanUrl(data.author_url || '');
  const match = authorUrl.match(/@([^/?#]+)/);
  const html = String(data.html || '');
  const idMatch = html.match(/data-video-id=["'](\d{8,})["']/i);

  post.username ||= match?.[1] || '';
  post.nickname ||= clean(data.author_name || '');
  post.caption ||= clean(data.title || '');
  post.cover ||= cleanUrl(data.thumbnail_url || '');
  post.id ||= idMatch?.[1] || '';
  if (!post.url && post.username && post.id) post.url = `${TIKTOK}/@${post.username}/video/${post.id}`;
  return post;
}

async function resolveProfile(post) {
  const username = String(post?.username || '').replace(/^@/, '').trim();
  return fetchTikTokProfile(username, post);
}

async function getVerificationData(url) {
  const originalUrl = cleanUrl(url);
  // TikWM dan @ssut dicoba paralel. Jika TikWM membalas HTTP 403, hasil getPost
  // tetap dapat dipakai apabila sumber alternatif mengizinkan akses ke metadata.
  const jobs = await Promise.allSettled([
    fetchTikWMPost(originalUrl),
    fetchOEmbed(originalUrl),
    fetchSSUTPost(originalUrl)
  ]);

  const tikwmPost = jobs[0].status === 'fulfilled' ? jobs[0].value : null;
  const oembed = jobs[1].status === 'fulfilled' ? jobs[1].value : null;
  const ssutPost = jobs[2].status === 'fulfilled' ? jobs[2].value : null;
  let post = mergePost(tikwmPost, ssutPost);

  if (!post) {
    const details = [
      jobs[0].status === 'rejected' ? `TikWM: ${jobs[0].reason?.message || 'gagal'}` : '',
      jobs[2].status === 'rejected' ? `@ssut: ${jobs[2].reason?.message || 'gagal'}` : '',
      jobs[1].status === 'rejected' ? `oEmbed: ${jobs[1].reason?.message || 'gagal'}` : ''
    ].filter(Boolean).join(' | ');
    throw new Error(`Metadata VT gagal diambil${details ? `: ${details}` : '.'}`);
  }

  if (oembed) post = enrichFromOEmbed(post, oembed);

  if (!post.id && post.url) {
    const idMatch = String(post.url).match(/\/(?:video|photo)\/(\d{8,})/i);
    if (idMatch) post.id = idMatch[1];
  }

  if (!post.username && post.url) {
    try {
      const u = new URL(post.url);
      const found = u.pathname.split('/').find(x => x.startsWith('@'));
      if (found) post.username = decodeURIComponent(found.slice(1));
    } catch {}
  }

  if (!post.url && post.username && post.id) {
    post.url = `${TIKTOK}/@${post.username}/${post.isImagePost ? 'photo' : 'video'}/${post.id}`;
  }

  // Seed profil dari author VT dahulu, lalu enrich lewat getUser(), TikWM
  // user/info, dan halaman profil publik secara paralel.
  const profile = await resolveProfile(post);

  return {
    post,
    profile,
    originalUrl
  };
}


function extractTikTokUrl(text) {
  const input = String(text || '').trim();
  if (!input) return '';

  if (/^https?:\/\//i.test(input)) {
    try {
      const u = new URL(input);
      if (isTikTokHost(u.hostname)) return cleanUrl(u.toString());
    } catch {}
  }

  const matches = input.match(/https?:\/\/[^\s<>\]\[{}"'`]+/gi) || [];
  for (const candidate of matches) {
    const cleaned = cleanUrl(candidate);
    try {
      const u = new URL(cleaned);
      if (isTikTokHost(u.hostname)) return cleaned;
    } catch {}
  }
  return '';
}
function extractHashtags(text) {
  const out = [];
  for (const match of String(text || '').matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    const tag = `#${match[1]}`;
    if (!out.some(x => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

async function fetchText(url, options = {}, timeout = REQUEST_TIMEOUT) {
  const response = await fetchWithTimeout(url, options, timeout);
  const text = await response.text();
  return { response, text };
}

const UAW = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
async function tikwmPostForm(p, body) {
  const r = await fetchWithTimeout(`${TIKWM}${p}`, {
    method: 'POST',
    headers: { 'User-Agent': UAW, 'Accept': 'application/json,text/plain,*/*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Cookie: 'current_language=en' },
    body: new URLSearchParams(body).toString()
  });
  const j = safeJsonParse(await r.text(), null);
  if (!j) throw new Error(`TikWM HTTP ${r.status} (bukan JSON)`);
  return j;
}
const strip = ({ raw, ...rest }) => rest;
const tagText = x => {
  const c = x.caption || '';
  if (/#/.test(c)) return c;
  return (c + ' ' + (x.hashtags || []).map(h => '#' + String(typeof h === 'string' ? h : (h?.name || h?.hashtag_name || '')).replace(/^#/, '')).join(' ')).trim();
};

async function route(p, q) {
  const id = String(q.unique_id || '').replace(/^@/, '').trim();
  if (p === '/') {
    const url = extractTikTokUrl(q.url) || cleanUrl(q.url);
    if (!url) throw new Error('URL kosong');
    const d = await getVerificationData(url);
    const x = d.post;
    return { code: 0, data: {
      id: x.id, video_id: x.id, title: tagText(x), play_count: x.views, digg_count: x.likes,
      comment_count: x.comments, share_count: x.shares, create_time: x.createTime, url: x.url,
      author: { unique_id: x.username, nickname: x.nickname },
      profile: d.profile ? strip(d.profile) : null
    } };
  }
  if (p === '/user/info') {
    if (!id) throw new Error('username kosong');
    const prof = await fetchTikTokProfile(id, null);
    if (!prof || (!prof.nickname && !prof.signature)) throw new Error('Profil tidak bisa dibaca (kemungkinan diblokir TikTok/TikWM dari server). Coba pakai link video.');
    return { code: 0, data: { user: strip(prof) } };
  }
  if (p === '/user/posts') {
    if (!id) throw new Error('username kosong');
    return tikwmPostForm('/user/posts', { unique_id: '@' + id, count: q.count || 30, cursor: q.cursor || 0 });
  }
  throw new Error('path tidak diizinkan');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    res.status(200).json(await route(req.query?.p, req.query || {}));
  } catch (e) {
    res.status(200).json({ code: -1, msg: String(e?.message || e).slice(0, 500) });
  }
}
