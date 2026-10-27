/* Launch buttons stay unavailable until the checked PlayCanvas export is present. */
(() => {
  'use strict';
  async function prepareLaunch() {
    const buttons = [...document.querySelectorAll('[data-game-link]')];
    const status = [...document.querySelectorAll('[data-launch-status]')];
    let ready = false;
    const requirements = 'Desktop browser · Keyboard and mouse · Headphones recommended · Flashing lights and sudden sounds.';
    buttons.forEach(button => button.addEventListener('click', event => {
      if (ready) return;
      event.preventDefault();
      status.forEach(node => { node.textContent = 'The playable build is being prepared. Please check back shortly. ' + requirements; });
    }));
    // Clearly distinguish the existing interactive site toys from campaign features.
    document.querySelectorAll('[data-site-preview]').forEach(section => {
      const title = section.querySelector('.section-title');
      if (!title) return;
      const note = document.createElement('p');
      note.className = 'lead narrow';
      note.textContent = 'Interactive website concept preview. These controls do not affect the playable campaign.';
      title.insertAdjacentElement('afterend', note);
    });
    try {
      const response = await fetch('play/release-ready.json', { cache: 'no-store' });
      if (!response.ok) return;
      const build = await response.json();
      if (build.ready !== true || !Array.isArray(build.chapters) || build.chapters.length !== 5) return;
      ready = true;
      buttons.forEach(button => { button.textContent = 'Play the Five-Chapter Story'; button.removeAttribute('aria-disabled'); });
      status.forEach(node => { node.textContent = requirements; });
    } catch (_) {
      // A missing build must not leave a live button pointing at a broken game.
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepareLaunch);
  else prepareLaunch();
})();
