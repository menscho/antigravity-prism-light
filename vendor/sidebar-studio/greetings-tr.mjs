// Obsidian Prism — Turkish (tr) greeting pools for Sidebar Studio (vendor/sidebar-studio/state-machine.mjs)
// Extracted standalone ESM module to keep legacy monolith state-machine.mjs within Constitution Law 2 size ratchet.
export const TR_GREETING_POOL = Object.freeze({
  withUser: Object.freeze([
    'Merhaba, {user}!',
    'Hoş geldin, {user}!',
    'Bugün ne üzerinde çalışalım, {user}?',
    'Hazır olduğunda başlayalım, {user}.',
  ]),
  anonymous: Object.freeze([
    'Hoş geldin!',
    'Bugün ne üzerinde çalışalım?',
    'Hazır olduğunda başlayalım.',
  ]),
});

export const TR_HERO_GREETING_POOL = Object.freeze({
  eyebrowWithUser: Object.freeze([
    'Merhaba, {user}',
    'Tekrar hoş geldin, {user}',
    'Başlamaya hazır mısın, {user}',
  ]),
  eyebrowAnonymous: Object.freeze([
    'Merhaba',
    'Tekrar hoş geldin',
    'Hazır olduğunda başlayalım',
  ]),
  headlines: Object.freeze([
    'Nereden başlayalım?',
    'Bugün sana nasıl yardımcı olabilirim?',
    'Neyi keşfetmek istersin?',
  ]),
});
