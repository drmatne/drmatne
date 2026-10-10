(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^(https?:\/\/|\/)/i.test(String(u || '')) ? String(u) : '');

  let state = { settings: {}, doctors: [], services: [], facilities: [], offers: [], gallery: [] };

  const waLink = (text) => {
    const num = String(state.settings.whatsapp || '').replace(/\D/g, '');
    const msg = text ?? state.settings.whatsappMessage ?? '';
    return `https://wa.me/${num}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
  };
  const telLink = (phone) => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
  const prettyWa = (num) => {
    const d = String(num || '').replace(/\D/g, '');
    return d.length === 12 && d.startsWith('91') ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
  };
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };
  const localToday = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const TOOTH = '<svg viewBox="0 0 24 24"><path d="M12 5.2c-1.3 0-2-.6-3.1-.6-1.9 0-3.2 1.5-3.2 3.7 0 1.6.6 2.6.9 4 .4 1.8.5 6.5 2 6.5 1.3 0 1.2-3.6 2-4.6.4-.5.9-.6 1.4-.6s1 .1 1.4.6c.8 1 .7 4.6 2 4.6 1.5 0 1.6-4.7 2-6.5.3-1.4.9-2.4.9-4 0-2.2-1.3-3.7-3.2-3.7-1.1 0-1.8.6-3.1.6z"/></svg>';
  const ARROW = '<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const WA = '<svg class="i i-fill" viewBox="0 0 24 24"><use href="#ico-wa"/></svg>';

  /* ------------------------------------------------------------ header */

  const header = $('#siteHeader');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const toggle = $('#menuToggle');
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  toggle.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#nav a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  $('#year').textContent = new Date().getFullYear();

  /* ------------------------------------------------------------ reveal */

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    : null;
  const observeReveals = () => $$('.reveal:not(.in)').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

  /* ------------------------------------------------------------ render */

  function applySettings() {
    const s = state.settings;
    $$('[data-s]').forEach((el) => {
      const key = el.dataset.s;
      if (key === 'heroTitle') return;
      const val = s[key];
      if (val) el.textContent = val;
      else if (el.matches('a, span') && !el.closest('.hero')) el.hidden = true;
    });

    // Hero title with an accented tail
    const title = s.heroTitle || '';
    const words = title.trim().split(/\s+/);
    const tail = words.length > 3 ? words.splice(-2).join(' ') : '';
    $('.hero-title').innerHTML = tail ? `${esc(words.join(' '))} <span class="accent">${esc(tail)}</span>` : esc(title);

    if (s.announcement) {
      $('#announceText').textContent = s.announcement;
      $('#announce').hidden = false;
    }

    $$('[data-wa]').forEach((a) => {
      a.href = waLink();
      a.target = '_blank';
      a.rel = 'noopener';
    });
    $$('[data-call]').forEach((a) => (a.href = telLink(s.phone)));
    $$('[data-call2]').forEach((a) => {
      if (s.phone2) a.href = telLink(s.phone2);
      else a.hidden = true;
    });
    $('#waDisplay').textContent = prettyWa(s.whatsapp);

    const q = encodeURIComponent(s.mapQuery || s.address || 'Jalna');
    $('#mapFrame').src = `https://www.google.com/maps?q=${q}&output=embed`;
    $('#directionsLink').href = safeUrl(s.mapsLink) || `https://www.google.com/maps/dir/?api=1&destination=${q}`;
    const reviews = safeUrl(s.googleReviewsUrl);
    if (reviews) $('#reviewsLink').href = reviews;
    else $('#reviewsLink').hidden = true;

    const socials = [];
    if (safeUrl(s.instagram)) socials.push(`<a href="${esc(s.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/></svg></a>`);
    if (safeUrl(s.facebook)) socials.push(`<a href="${esc(s.facebook)}" target="_blank" rel="noopener" aria-label="Facebook"><svg class="i" viewBox="0 0 24 24"><path d="M14 8h3V4h-3a4 4 0 00-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z"/></svg></a>`);
    $('#socials').innerHTML = socials.join('');
    $('#socials').hidden = !socials.length;
  }

  function renderMarquee() {
    const items = (state.facilities.length ? state.facilities : state.services.map((s) => ({ en: s.title })))
      .map((f) => `<span class="marquee-item">${TOOTH}<span>${esc(f.en)}</span>${f.mr ? `<span class="mr">${esc(f.mr)}</span>` : ''}</span>`)
      .join('');
    $('#marqueeTrack').innerHTML = items + items;
  }

  function renderOffers() {
    const offers = state.offers;
    const section = $('#offers');
    section.hidden = !offers.length;
    $$('[data-offers-link]').forEach((a) => (a.hidden = !offers.length));
    if (!offers.length) return;

    $('#offersTrack').innerHTML = offers.map((o, i) => `
      <button class="offer-card reveal" style="--d:${Math.min(i, 3) * 0.08}s" data-offer="${esc(o.id)}" aria-label="View offer: ${esc(o.title || 'Offer')}">
        <div class="offer-poster">
          ${o.poster ? `<img src="${esc(safeUrl(o.poster))}" alt="${esc(o.title)}" loading="lazy" />` : `<div class="placeholder">${esc(o.title)}</div>`}
          ${o.validTill ? `<span class="offer-badge">Till ${esc(fmtDate(o.validTill).replace(/^\w+, /, ''))}</span>` : ''}
        </div>
        <div class="offer-body">
          ${o.title ? `<h3>${esc(o.title)}</h3>` : ''}
          ${o.description ? `<p>${esc(o.description)}</p>` : ''}
          ${o.price ? `<div class="offer-price"><strong>${esc(o.price)}</strong>${o.originalPrice ? `<s>${esc(o.originalPrice)}</s>` : ''}</div>` : ''}
          <span class="offer-more">View details ${ARROW}</span>
        </div>
      </button>`).join('');

    const track = $('#offersTrack');
    $$('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
      track.scrollBy({ left: Number(b.dataset.scroll) * track.clientWidth * 0.9, behavior: 'smooth' });
    }));
    track.addEventListener('click', (e) => {
      const card = e.target.closest('[data-offer]');
      if (card) openOffer(card.dataset.offer);
    });
  }

  function renderServices() {
    $('#servicesGrid').innerHTML = state.services.map((s, i) => `
      <article class="service-card reveal" style="--d:${(i % 3) * 0.08}s">
        ${s.image ? `<img src="${esc(safeUrl(s.image))}" alt="" loading="lazy" />` : ''}
        <span class="service-num">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.desc)}</p>
        <a href="#appointment" class="service-link" data-prefill-service="${esc(s.title)}">Book this treatment ${ARROW}</a>
      </article>`).join('');

    $('#facilitiesList').innerHTML = state.facilities
      .map((f) => `<li><span><strong>${esc(f.en)}</strong>${f.mr ? `<span class="mr">${esc(f.mr)}</span>` : ''}</span></li>`)
      .join('');
    $('.facilities').hidden = !state.facilities.length;

    const select = $('#serviceSelect');
    state.services.forEach((s) => select.add(new Option(s.title, s.title)));
    select.add(new Option('Other / Not sure', 'Other'));

    $('#footerServices').innerHTML = state.services.slice(0, 5)
      .map((s) => `<li><a href="#services">${esc(s.title)}</a></li>`).join('');
  }

  function renderDoctors() {
    $('#doctorsGrid').innerHTML = state.doctors.map((d, i) => {
      const photo = safeUrl(d.photo);
      const alt = safeUrl(d.photoAlt);
      const pos = esc(d.photoPosition || '50% 20%');
      const first = esc((d.name || '').replace(/\s*\(.*\)\s*/, '').split(' ').slice(0, 2).join(' '));
      return `
      <article class="doctor-card reveal" style="--d:${i * 0.1}s">
        <div class="doctor-photo">
          ${d.degree ? `<span class="doctor-degree">${esc(d.degree)}</span>` : ''}
          ${photo ? `<img src="${esc(photo)}" alt="${esc(d.name)}" loading="lazy" style="object-position:${pos}" class="${alt ? 'has-alt' : ''}" />` : ''}
          ${alt ? `<img src="${esc(alt)}" alt="" loading="lazy" class="alt" style="object-position:50% 20%" />` : ''}
        </div>
        <div class="doctor-info">
          ${d.nameLocal ? `<span class="mr">${esc(d.nameLocal)}</span>` : ''}
          <h3>${esc(d.name)}</h3>
          ${d.title ? `<span class="doctor-title">${esc(d.title)}</span>` : ''}
          ${d.extra ? `<span class="doctor-extra">${esc(d.extra)}</span>` : ''}
          ${d.bio ? `<p class="doctor-bio">${esc(d.bio)}</p>` : ''}
          <div class="doctor-actions">
            <a href="#appointment" class="btn btn-primary btn-sm" data-prefill-doctor="${esc(d.name)}">Book with ${first}</a>
            <a href="${esc(waLink(`Hello ${d.name}, I would like to consult you.`))}" class="btn btn-ghost btn-sm" target="_blank" rel="noopener">${WA} Ask a question</a>
          </div>
        </div>
      </article>`;
    }).join('');

    const select = $('#doctorSelect');
    state.doctors.forEach((d) => select.add(new Option(d.name, d.name)));
  }

  function renderGallery() {
    const grid = $('#galleryGrid');
    $('#gallery').hidden = !state.gallery.length;
    grid.innerHTML = state.gallery.map((g, i) => `
      <figure class="gallery-item reveal" style="--d:${(i % 3) * 0.06}s" data-index="${i}" tabindex="0" role="button" aria-label="Open image${g.caption ? `: ${esc(g.caption)}` : ''}">
        <img src="${esc(safeUrl(g.src))}" alt="${esc(g.caption || 'Clinic photo')}" loading="lazy" />
        ${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}
      </figure>`).join('');

    const open = (el) => openGallery(Number(el.dataset.index));
    grid.addEventListener('click', (e) => {
      const item = e.target.closest('.gallery-item');
      if (item) open(item);
    });
    grid.addEventListener('keydown', (e) => {
      const item = e.target.closest('.gallery-item');
      if (item && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        open(item);
      }
    });
  }

  /* ------------------------------------------------------------ modal */

  const modal = $('#modal');
  const modalBody = $('#modalBody');
  let galleryIndex = -1;
  let lastFocus = null;

  function showModal(html, { nav = false } = {}) {
    lastFocus = document.activeElement;
    modalBody.innerHTML = html;
    $('#modalPrev').hidden = !nav;
    $('#modalNext').hidden = !nav;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.modal-close', modal).focus();
  }

  function closeModal() {
    modal.hidden = true;
    modalBody.innerHTML = '';
    galleryIndex = -1;
    document.body.style.overflow = '';
    lastFocus?.focus?.();
  }

  function openGallery(i) {
    const n = state.gallery.length;
    galleryIndex = (i + n) % n;
    const g = state.gallery[galleryIndex];
    showModal(`<div><img src="${esc(safeUrl(g.src))}" alt="${esc(g.caption || 'Clinic photo')}" />${g.caption ? `<p class="modal-caption">${esc(g.caption)}</p>` : ''}</div>`, { nav: n > 1 });
  }

  function openOffer(id) {
    const o = state.offers.find((x) => x.id === id);
    if (!o) return;
    const waText = `Hello Doctor, I'm interested in the offer "${o.title || 'current offer'}". Please share details.`;
    showModal(`
      <div class="offer-modal">
        <div class="offer-modal-poster">${o.poster ? `<img src="${esc(safeUrl(o.poster))}" alt="${esc(o.title)}" />` : ''}</div>
        <div class="offer-modal-body">
          <span class="eyebrow">Special offer</span>
          ${o.title ? `<h3>${esc(o.title)}</h3>` : ''}
          ${o.price ? `<div class="offer-price"><strong>${esc(o.price)}</strong>${o.originalPrice ? `<s>${esc(o.originalPrice)}</s>` : ''}</div>` : ''}
          ${o.description ? `<p>${esc(o.description)}</p>` : ''}
          ${o.validTill ? `<span class="valid">Valid till ${esc(fmtDate(o.validTill))}</span>` : ''}
          <div class="actions">
            <a class="btn btn-wa" href="${esc(waLink(waText))}" target="_blank" rel="noopener">${WA} Claim on WhatsApp</a>
            <a class="btn btn-primary" href="#appointment" data-prefill-service="Offer: ${esc(o.title || 'Special offer')}" data-close>Book appointment</a>
          </div>
        </div>
      </div>`);
  }

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  $('#modalPrev').addEventListener('click', () => openGallery(galleryIndex - 1));
  $('#modalNext').addEventListener('click', () => openGallery(galleryIndex + 1));
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') closeModal();
    if (galleryIndex >= 0 && e.key === 'ArrowLeft') openGallery(galleryIndex - 1);
    if (galleryIndex >= 0 && e.key === 'ArrowRight') openGallery(galleryIndex + 1);
  });

  /* ------------------------------------------------------------ prefill */

  document.addEventListener('click', (e) => {
    const svc = e.target.closest('[data-prefill-service]');
    const doc = e.target.closest('[data-prefill-doctor]');
    if (svc) {
      const select = $('#serviceSelect');
      const value = svc.dataset.prefillService;
      if (![...select.options].some((o) => o.value === value)) select.add(new Option(value, value));
      select.value = value;
    }
    if (doc) $('#doctorSelect').value = doc.dataset.prefillDoctor;
  });

  /* ------------------------------------------------------------ appointment form */

  const form = $('#apptForm');
  const dateInput = $('#apptDate');
  dateInput.min = localToday();
  dateInput.value = localToday();

  const errorBox = $('#formError');
  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    $$('.invalid', form).forEach((el) => el.classList.remove('invalid'));

    const data = Object.fromEntries(new FormData(form));
    const bad = [];
    if (data.name.trim().length < 2) bad.push('name');
    if (data.phone.replace(/\D/g, '').length < 10) bad.push('phone');
    if (!data.date || data.date < localToday()) bad.push('date');
    if (bad.length) {
      bad.forEach((n) => form.elements[n].classList.add('invalid'));
      form.elements[bad[0]].focus();
      showError('Please check the highlighted fields: name, a 10-digit mobile number and a date from today onwards.');
      return;
    }

    const btn = $('#apptSubmit');
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send your request.');

      // WhatsApp renders *text* as bold. Optional lines are null and dropped.
      const opt = (value, line) => (value ? line : null);
      const lines = [
        'Hello Doctor 👋',
        'I have requested an *appointment* on your website:',
        '',
        `👤 *Name:* ${data.name.trim()}`,
        `📱 *Mobile:* ${data.phone.trim()}`,
        `📅 *Date:* ${fmtDate(data.date)}`,
        opt(data.time, `🕐 *Time:* ${data.time}`),
        opt(data.service, `🦷 *Treatment:* ${data.service}`),
        opt(data.doctor, `🩺 *Doctor:* ${data.doctor}`),
        opt(data.message.trim(), `📝 *Note:* ${data.message.trim()}`),
        '',
        'Please confirm my appointment. Thank you!',
      ].filter((line) => line !== null);
      $('#successName').textContent = data.name.split(' ')[0];
      $('#successDate').textContent = fmtDate(data.date);
      $('#successWa').href = waLink(lines.join('\n'));
      form.hidden = true;
      $('#apptSuccess').hidden = false;
      form.reset();
      dateInput.value = localToday();
    } catch (err) {
      showError(`${err.message} You can also book directly on WhatsApp.`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });

  $('#apptAgain').addEventListener('click', () => {
    $('#apptSuccess').hidden = true;
    form.hidden = false;
  });

  /* ------------------------------------------------------------ boot */

  async function boot() {
    try {
      const res = await fetch('/api/public', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      state = { ...state, ...(await res.json()) };
    } catch (err) {
      console.error('Could not load clinic data', err);
    }
    applySettings();
    renderMarquee();
    renderOffers();
    renderServices();
    renderDoctors();
    renderGallery();
    observeReveals();
  }

  observeReveals();
  boot();
})();
