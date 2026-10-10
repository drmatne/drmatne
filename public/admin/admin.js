(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICON = {
    trash: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>',
    up: '<svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    down: '<svg class="i" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    upload: '<svg class="i" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>',
    cal: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/></svg>',
    phone: '<svg class="i" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2"/></svg>',
    wa: '<svg class="i" viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>',
    image: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/></svg>',
  };

  let data = null;
  let currentTab = 'appointments';
  const apptFilter = { status: 'upcoming', q: '' };
  let editingOfferId = null;

  /* ------------------------------------------------------------ utils */

  function toast(msg, isError = false) {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' err' : ''}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), isError ? 5000 : 2800);
  }

  // Phone photos are often 5–10 MB, and the host rejects requests over 4.5 MB,
  // so resize large images in the browser before uploading.
  async function shrinkImage(file, maxSide = 2000, quality = 0.85) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!out || out.size >= file.size) return file;
      return new File([out], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch {
      return file;
    }
  }

  async function shrinkForm(form) {
    const out = new FormData();
    for (const [key, value] of form.entries()) {
      if (value instanceof File && value.size) out.append(key, await shrinkImage(value));
      else if (!(value instanceof File)) out.append(key, value);
    }
    return out;
  }

  async function api(path, { method = 'GET', body, form } = {}) {
    const opts = { method, headers: {} };
    if (form) opts.body = await shrinkForm(form);
    else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/admin/login') {
      showLogin();
      throw new Error('Session expired. Please log in again.');
    }
    if (res.status === 413) throw new Error('That image is too large to upload. Try a smaller photo.');
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  async function withBusy(btn, fn) {
    const label = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving…';
    }
    try {
      return await fn();
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    }
  }

  const localToday = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const fmtDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const phoneDigits = (p) => {
    let d = String(p || '').replace(/\D/g, '');
    if (d.length === 10) d = `91${d}`;
    return d;
  };
  const offerState = (o) => {
    if (!o.active) return ['off', 'Hidden'];
    if (o.validTill && o.validTill < localToday()) return ['exp', 'Expired'];
    return ['live', 'Live'];
  };

  function bindDrop(drop, onFiles) {
    const input = $('input[type=file]', drop);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) {
        input.files = e.dataTransfer.files;
        onFiles(input.files);
      }
    });
    input.addEventListener('change', () => onFiles(input.files));
  }

  /* ------------------------------------------------------------ auth */

  function showLogin() {
    $('#appView').hidden = true;
    $('#loginView').hidden = false;
    $('#loginForm [name=password]').focus();
  }

  async function showApp() {
    data = await api('/api/admin/data');
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#defaultPwWarn').hidden = !data.usingDefaultPassword;
    updateBadge();
    render();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#loginError');
    err.hidden = true;
    try {
      await api('/api/admin/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      f.password.value = '';
      await showApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  async function logout() {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  }
  $('#logoutBtn').addEventListener('click', logout);

  /* ------------------------------------------------------------ tabs */

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) switchTab(g.dataset.goto);
  });

  function switchTab(tab) {
    currentTab = tab;
    $$('#tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    render();
    window.scrollTo({ top: 0 });
  }

  function updateBadge() {
    const n = data.appointments.filter((a) => a.status === 'new').length;
    const badge = $('#newBadge');
    badge.textContent = n;
    badge.hidden = !n;
  }

  function render() {
    const panel = $('#panel');
    ({
      appointments: renderAppointments,
      offers: renderOffers,
      gallery: renderGallery,
      doctors: renderDoctors,
      services: renderServices,
      settings: renderSettings,
      account: renderAccount,
    })[currentTab](panel);
  }

  /* ------------------------------------------------------------ appointments */

  function renderAppointments(panel) {
    const today = localToday();
    const all = data.appointments;
    const stats = {
      new: all.filter((a) => a.status === 'new').length,
      today: all.filter((a) => a.date === today && a.status !== 'cancelled').length,
      upcoming: all.filter((a) => a.date >= today && ['new', 'confirmed'].includes(a.status)).length,
      total: all.length,
    };

    const q = apptFilter.q.toLowerCase();
    let list = all.filter((a) => {
      if (apptFilter.status === 'upcoming' && !(a.date >= today && ['new', 'confirmed'].includes(a.status))) return false;
      if (!['all', 'upcoming'].includes(apptFilter.status) && a.status !== apptFilter.status) return false;
      if (q && !`${a.name} ${a.phone} ${a.service} ${a.message}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (apptFilter.status === 'upcoming') list = list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const chips = [['upcoming', 'Upcoming'], ['new', 'New'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']];

    panel.innerHTML = `
      <div class="panel-head">
        <div><h1>Appointments</h1><p>Requests from the website booking form.</p></div>
        <a class="btn ghost" href="/api/admin/appointments.csv">Export to Excel (CSV)</a>
      </div>
      <div class="stats">
        <div class="stat"><small>New requests</small><strong>${stats.new}</strong></div>
        <div class="stat"><small>Today</small><strong>${stats.today}</strong></div>
        <div class="stat"><small>Upcoming</small><strong>${stats.upcoming}</strong></div>
        <div class="stat"><small>All time</small><strong>${stats.total}</strong></div>
      </div>
      <div class="toolbar">
        <div class="chips">${chips.map(([k, l]) => `<button class="chip ${apptFilter.status === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
        <input class="search" type="search" placeholder="Search name, phone, treatment…" value="${esc(apptFilter.q)}" id="apptSearch" />
      </div>
      <div class="appt-list">
        ${list.length ? list.map(apptCard).join('') : `<div class="card empty">${ICON.cal}<p>No appointments here yet.</p></div>`}
      </div>`;

    $$('[data-filter]', panel).forEach((b) => b.addEventListener('click', () => { apptFilter.status = b.dataset.filter; render(); }));
    const search = $('#apptSearch');
    search.addEventListener('input', () => {
      apptFilter.q = search.value;
      const pos = search.selectionStart;
      render();
      const s = $('#apptSearch');
      s.focus();
      s.setSelectionRange(pos, pos);
    });

    $$('[data-status]', panel).forEach((sel) => sel.addEventListener('change', async () => {
      try {
        const { appointment } = await api(`/api/admin/appointments/${sel.dataset.status}`, { method: 'PATCH', body: { status: sel.value } });
        Object.assign(data.appointments.find((a) => a.id === appointment.id), appointment);
        updateBadge();
        render();
        toast(`Marked as ${appointment.status}`);
      } catch (err) { toast(err.message, true); }
    }));

    $$('[data-del-appt]', panel).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this appointment permanently?')) return;
      try {
        await api(`/api/admin/appointments/${b.dataset.delAppt}`, { method: 'DELETE' });
        data.appointments = data.appointments.filter((a) => a.id !== b.dataset.delAppt);
        updateBadge();
        render();
        toast('Appointment deleted');
      } catch (err) { toast(err.message, true); }
    }));
  }

  // WhatsApp renders *text* as bold and _text_ as italic. Optional lines are null and dropped.
  function confirmMessage(a) {
    const s = data.settings;
    const clinic = [s.clinicName, s.clinicSubName].filter(Boolean).join(' ');
    const mapQuery = encodeURIComponent(s.mapQuery || s.address || clinic).replace(/%20/g, '+').replace(/%2C/g, ',');
    const mapUrl = s.mapsLink || `https://maps.google.com/?q=${mapQuery}`;
    const treatment = a.service && a.service !== 'Other' ? a.service.replace(/^Offer: /, '') : '';
    const opt = (value, line) => (value ? line : null);
    return [
      `Hello *${a.name.trim()}* 👋`,
      '',
      `Your appointment at *${s.clinicName}* is *confirmed* ✅`,
      '',
      `📅 *Date:* ${fmtDate(a.date)}`,
      opt(a.time, `🕐 *Time:* ${a.time}`),
      opt(treatment, `🦷 *Treatment:* ${treatment}`),
      opt(a.doctor, `🩺 *Doctor:* ${a.doctor}`),
      '',
      opt(s.address, `📍 *Address:* ${s.address}`),
      `🗺️ *Directions:* ${mapUrl}`,
      opt(s.phone, `📞 *Call:* ${s.phone}`),
      '',
      'Please arrive 10 minutes early and bring any previous X-rays or prescriptions.',
      'Need to reschedule? Just reply to this message.',
      '',
      `— _${clinic}_`,
    ].filter((line) => line !== null).join('\n');
  }

  function apptCard(a) {
    const isToday = a.date === localToday();
    const confirmMsg = confirmMessage(a);
    return `
      <article class="appt s-${esc(a.status)}">
        <div>
          <div class="appt-name">${esc(a.name)} ${isToday ? '<span class="today-tag">TODAY</span>' : ''}</div>
          <span class="appt-when">${ICON.cal} ${esc(fmtDate(a.date))} · ${esc(a.time || '')}</span>
          <div class="appt-meta">
            <span><b>Mobile:</b> <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></span>
            ${a.service ? `<span><b>Treatment:</b> ${esc(a.service)}</span>` : ''}
            ${a.doctor ? `<span><b>Doctor:</b> ${esc(a.doctor)}</span>` : ''}
          </div>
          ${a.message ? `<div class="appt-msg">${esc(a.message)}</div>` : ''}
          <small class="created">Requested ${esc(fmtDateTime(a.createdAt))}</small>
        </div>
        <div class="appt-actions">
          <select data-status="${esc(a.id)}" aria-label="Status">
            ${['new', 'confirmed', 'completed', 'cancelled'].map((s) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
          </select>
          <div class="row">
            <a class="btn sm ghost" href="tel:${esc(a.phone)}">${ICON.phone} Call</a>
            <a class="btn sm wa" href="https://wa.me/${phoneDigits(a.phone)}?text=${encodeURIComponent(confirmMsg)}" target="_blank" rel="noopener">${ICON.wa} Confirm</a>
          </div>
          <button class="btn sm danger" data-del-appt="${esc(a.id)}">${ICON.trash} Delete</button>
        </div>
      </article>`;
  }

  /* ------------------------------------------------------------ offers */

  function renderOffers(panel) {
    const editing = data.offers.find((o) => o.id === editingOfferId) || null;
    panel.innerHTML = `
      <div class="panel-head">
        <div><h1>Offers &amp; Posters</h1><p>Upload offer posters. Live offers appear on the website automatically; expired ones are hidden after their end date.</p></div>
      </div>
      <div class="split">
        <form class="card sticky" id="offerForm">
          <h2>${editing ? 'Edit offer' : 'New offer'}</h2>
          <label class="drop" id="posterDrop">
            <input type="file" name="poster" accept="image/*" />
            ${editing?.poster ? `<img class="preview" src="${esc(editing.poster)}" alt="" />` : `${ICON.upload}<strong>Upload poster</strong><span>Tap to choose or drag an image here (portrait 4:5 looks best)</span>`}
          </label>
          <div style="height:16px"></div>
          <label class="field"><span>Title</span><input name="title" maxlength="120" placeholder="e.g. Free dental check-up camp" value="${esc(editing?.title)}" /></label>
          <label class="field"><span>Description</span><textarea name="description" maxlength="800" placeholder="What's included, terms, etc.">${esc(editing?.description)}</textarea></label>
          <div class="grid-2">
            <label class="field"><span>Offer price</span><input name="price" maxlength="60" placeholder="₹999" value="${esc(editing?.price)}" /></label>
            <label class="field"><span>Original price</span><input name="originalPrice" maxlength="60" placeholder="₹1,500" value="${esc(editing?.originalPrice)}" /></label>
          </div>
          <label class="field"><span>Valid till</span><input type="date" name="validTill" value="${esc(editing?.validTill)}" /><small>Leave empty to keep it running until you hide it.</small></label>
          <label class="switch" style="margin-bottom:18px"><input type="checkbox" name="active" ${!editing || editing.active ? 'checked' : ''} /> Show on website</label>
          <div style="display:flex;gap:10px">
            <button class="btn primary" type="submit" style="flex:1">${editing ? 'Save changes' : 'Publish offer'}</button>
            ${editing ? '<button class="btn ghost" type="button" id="cancelEdit">Cancel</button>' : ''}
          </div>
        </form>
        <div>
          ${data.offers.length ? `<div class="items">${data.offers.map(offerItem).join('')}</div>` : `<div class="card empty">${ICON.image}<p>No offers yet. Upload your first poster on the left.</p></div>`}
        </div>
      </div>`;

    const form = $('#offerForm');
    bindDrop($('#posterDrop'), (files) => {
      const f = files[0];
      if (!f) return;
      const drop = $('#posterDrop');
      $$('.preview, .i, strong, span', drop).forEach((n) => n.remove());
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = URL.createObjectURL(f);
      drop.appendChild(img);
    });
    $('#cancelEdit')?.addEventListener('click', () => { editingOfferId = null; render(); });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      fd.set('active', form.active.checked ? 'true' : 'false');
      if (!form.poster.files.length) fd.delete('poster');
      if (!editing && !fd.get('poster') && !fd.get('title').trim()) return toast('Add a poster image or a title.', true);
      withBusy($('button[type=submit]', form), async () => {
        if (editing) {
          const { offer } = await api(`/api/admin/offers/${editing.id}`, { method: 'PUT', form: fd });
          Object.assign(editing, offer);
          toast('Offer updated');
        } else {
          const { offer } = await api('/api/admin/offers', { method: 'POST', form: fd });
          data.offers.unshift(offer);
          toast('Offer published');
        }
        editingOfferId = null;
        render();
      });
    });

    $$('[data-edit-offer]', panel).forEach((b) => b.addEventListener('click', () => { editingOfferId = b.dataset.editOffer; render(); }));
    $$('[data-toggle-offer]', panel).forEach((b) => b.addEventListener('click', async () => {
      const o = data.offers.find((x) => x.id === b.dataset.toggleOffer);
      const fd = new FormData();
      Object.entries({ title: o.title, description: o.description, price: o.price, originalPrice: o.originalPrice, validTill: o.validTill, active: String(!o.active) })
        .forEach(([k, v]) => fd.set(k, v ?? ''));
      try {
        const { offer } = await api(`/api/admin/offers/${o.id}`, { method: 'PUT', form: fd });
        Object.assign(o, offer);
        render();
        toast(o.active ? 'Offer is now visible' : 'Offer hidden');
      } catch (err) { toast(err.message, true); }
    }));
    $$('[data-del-offer]', panel).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this offer and its poster?')) return;
      try {
        await api(`/api/admin/offers/${b.dataset.delOffer}`, { method: 'DELETE' });
        data.offers = data.offers.filter((o) => o.id !== b.dataset.delOffer);
        if (editingOfferId === b.dataset.delOffer) editingOfferId = null;
        render();
        toast('Offer deleted');
      } catch (err) { toast(err.message, true); }
    }));
  }

  function offerItem(o) {
    const [cls, label] = offerState(o);
    return `
      <div class="item">
        <div class="item-img">
          ${o.poster ? `<img src="${esc(o.poster)}" alt="" loading="lazy" />` : `<div class="ph">${esc(o.title)}</div>`}
          <span class="item-tag ${cls}">${label}</span>
        </div>
        <div class="item-body">
          <strong>${esc(o.title || 'Untitled offer')}</strong>
          ${o.price ? `<span>${esc(o.price)} ${o.originalPrice ? `<s class="muted">${esc(o.originalPrice)}</s>` : ''}</span>` : ''}
          <small>${o.validTill ? `Valid till ${esc(fmtDate(o.validTill))}` : 'No end date'}</small>
        </div>
        <div class="item-actions">
          <button class="btn sm ghost" data-edit-offer="${esc(o.id)}">Edit</button>
          <button class="btn sm ghost" data-toggle-offer="${esc(o.id)}">${o.active ? 'Hide' : 'Show'}</button>
          <button class="icon-btn danger" data-del-offer="${esc(o.id)}" aria-label="Delete">${ICON.trash}</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------ gallery */

  function renderGallery(panel) {
    panel.innerHTML = `
      <div class="panel-head">
        <div><h1>Gallery</h1><p>Photos of your clinic, team, events and results. You can upload many at once.</p></div>
      </div>
      <form class="card" id="galleryForm">
        <h2>Upload photos</h2>
        <label class="drop" id="galleryDrop">
          <input type="file" name="images" accept="image/*" multiple />
          ${ICON.upload}<strong>Choose photos</strong><span>Tap to select or drag images here (up to 30 at once, 10 MB each)</span>
        </label>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:16px">
          <label class="field" style="flex:1;min-width:220px;margin:0"><span>Caption (optional)</span><input name="caption" maxlength="160" placeholder="e.g. Free check-up camp, March 2026" /></label>
          <button class="btn primary" type="submit">${ICON.upload} Upload</button>
        </div>
      </form>
      <div class="card">
        <h2>${data.gallery.length} photo${data.gallery.length === 1 ? '' : 's'} on the website</h2>
        ${data.gallery.length ? `<div class="g-grid">${data.gallery.map((g, i) => `
          <div class="g-item">
            <img src="${esc(g.src)}" alt="" loading="lazy" />
            <div class="g-body">
              <input value="${esc(g.caption)}" placeholder="Caption" data-caption="${esc(g.id)}" maxlength="160" />
              <div class="g-actions">
                <span>
                  <button class="icon-btn" data-move="${esc(g.id)}" data-dir="up" ${i === 0 ? 'disabled' : ''} aria-label="Move earlier">${ICON.up}</button>
                  <button class="icon-btn" data-move="${esc(g.id)}" data-dir="down" ${i === data.gallery.length - 1 ? 'disabled' : ''} aria-label="Move later">${ICON.down}</button>
                </span>
                <button class="icon-btn danger" data-del-g="${esc(g.id)}" aria-label="Delete">${ICON.trash}</button>
              </div>
            </div>
          </div>`).join('')}</div>` : `<div class="empty">${ICON.image}<p>No photos yet.</p></div>`}
      </div>`;

    const form = $('#galleryForm');
    bindDrop($('#galleryDrop'), (files) => {
      const drop = $('#galleryDrop');
      $$('.thumbs, .i, strong, span', drop).forEach((n) => n.remove());
      const wrap = document.createElement('div');
      wrap.className = 'thumbs';
      [...files].slice(0, 30).forEach((f) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        wrap.appendChild(img);
      });
      drop.appendChild(wrap);
      const note = document.createElement('strong');
      note.textContent = `${files.length} photo${files.length === 1 ? '' : 's'} selected`;
      drop.appendChild(note);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.images.files.length) return toast('Choose at least one photo.', true);
      // One photo per request keeps each upload under the host's size limit.
      const files = [...form.images.files].slice(0, 30);
      const caption = form.caption.value;
      const btn = $('button[type=submit]', form);
      withBusy(btn, async () => {
        const added = [];
        try {
          for (const [i, file] of files.entries()) {
            btn.textContent = `Uploading ${i + 1} of ${files.length}…`;
            const fd = new FormData();
            fd.append('images', file);
            fd.append('caption', caption);
            const { items } = await api('/api/admin/gallery', { method: 'POST', form: fd });
            added.unshift(...items);
          }
        } finally {
          if (added.length) {
            data.gallery.unshift(...added);
            render();
            toast(`${added.length} photo${added.length === 1 ? '' : 's'} uploaded`);
          }
        }
      });
    });

    $$('[data-caption]', panel).forEach((input) => input.addEventListener('change', async () => {
      try {
        await api(`/api/admin/gallery/${input.dataset.caption}`, { method: 'PUT', body: { caption: input.value } });
        data.gallery.find((g) => g.id === input.dataset.caption).caption = input.value;
        toast('Caption saved');
      } catch (err) { toast(err.message, true); }
    }));
    $$('[data-move]', panel).forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/admin/gallery/${b.dataset.move}/move`, { method: 'POST', body: { direction: b.dataset.dir } });
        const i = data.gallery.findIndex((g) => g.id === b.dataset.move);
        const j = i + (b.dataset.dir === 'up' ? -1 : 1);
        [data.gallery[i], data.gallery[j]] = [data.gallery[j], data.gallery[i]];
        render();
      } catch (err) { toast(err.message, true); }
    }));
    $$('[data-del-g]', panel).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this photo from the website?')) return;
      try {
        await api(`/api/admin/gallery/${b.dataset.delG}`, { method: 'DELETE' });
        data.gallery = data.gallery.filter((g) => g.id !== b.dataset.delG);
        render();
        toast('Photo removed');
      } catch (err) { toast(err.message, true); }
    }));
  }

  /* ------------------------------------------------------------ doctors */

  function doctorForm(d) {
    const slot = (key, cap) => `
      <div class="photo-slot ${d[key] ? '' : 'empty-slot'}" data-slot="${key}">
        <span class="cap">${cap}</span>
        ${d[key] ? `<img src="${esc(d[key])}" alt="" style="object-position:${esc(key === 'photo' ? d.photoPosition || '50% 20%' : '50% 20%')}" />` : '<span>No photo</span>'}
        <label>Change photo<input type="file" name="${key}" accept="image/*" /></label>
      </div>`;
    return `
      <form class="card doc-form" data-doc="${esc(d.id || '')}">
        <div class="doc-edit">
          <div class="doc-photos">
            ${slot('photo', 'Main photo')}
            ${slot('photoAlt', 'Hover photo')}
          </div>
          <div>
            <div class="grid-2">
              <label class="field"><span>Name (English)</span><input name="name" required maxlength="160" value="${esc(d.name)}" /></label>
              <label class="field"><span>Name (Marathi)</span><input name="nameLocal" maxlength="160" value="${esc(d.nameLocal)}" /></label>
            </div>
            <div class="grid-3">
              <label class="field"><span>Degree</span><input name="degree" maxlength="160" value="${esc(d.degree)}" placeholder="MDS" /></label>
              <label class="field" style="grid-column:span 2"><span>Title</span><input name="title" maxlength="160" value="${esc(d.title)}" placeholder="Oral & Maxillofacial Surgeon" /></label>
            </div>
            <label class="field"><span>Highlight</span><input name="extra" maxlength="160" value="${esc(d.extra)}" placeholder="Fellowship in Dental Implantology" /></label>
            <label class="field"><span>About</span><textarea name="bio" maxlength="1200" rows="4">${esc(d.bio)}</textarea></label>
            <label class="field"><span>Photo focus</span>
              <select name="photoPosition">
                ${[['50% 10%', 'Top (face high in photo)'], ['50% 20%', 'Upper'], ['50% 35%', 'Centre-upper'], ['50% 50%', 'Centre']].map(([v, l]) => `<option value="${v}" ${d.photoPosition === v ? 'selected' : ''}>${l}</option>`).join('')}
                ${d.photoPosition && !['50% 10%', '50% 20%', '50% 35%', '50% 50%'].includes(d.photoPosition) ? `<option value="${esc(d.photoPosition)}" selected>Custom (${esc(d.photoPosition)})</option>` : ''}
              </select>
              <small>Which part of the main photo stays visible when it's cropped.</small>
            </label>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn primary" type="submit">${d.id ? 'Save doctor' : 'Add doctor'}</button>
              ${d.id ? `<button class="btn danger" type="button" data-del-doc="${esc(d.id)}">${ICON.trash} Remove</button>` : ''}
            </div>
          </div>
        </div>
      </form>`;
  }

  function renderDoctors(panel) {
    panel.innerHTML = `
      <div class="panel-head">
        <div><h1>Doctors</h1><p>Photos and details shown in the “Meet your doctors” section. The hover photo appears when visitors move the mouse over the card.</p></div>
        <button class="btn ghost" id="addDoc">+ Add doctor</button>
      </div>
      <div id="newDocSlot"></div>
      ${data.doctors.map(doctorForm).join('')}`;

    $('#addDoc').addEventListener('click', () => {
      $('#newDocSlot').innerHTML = doctorForm({ photoPosition: '50% 20%' });
      bindDoctorForms(panel);
      $('#newDocSlot input[name=name]').focus();
    });
    bindDoctorForms(panel);
  }

  function bindDoctorForms(panel) {
    $$('.doc-form', panel).forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = '1';
      $$('input[type=file]', form).forEach((input) => input.addEventListener('change', () => {
        const f = input.files[0];
        if (!f) return;
        const slot = input.closest('.photo-slot');
        slot.classList.remove('empty-slot');
        $$('img, span:not(.cap)', slot).forEach((n) => n.remove());
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        slot.prepend(img);
      }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        ['photo', 'photoAlt'].forEach((k) => { if (!form[k].files.length) fd.delete(k); });
        const id = form.dataset.doc;
        withBusy($('button[type=submit]', form), async () => {
          if (id) {
            const { doctor } = await api(`/api/admin/doctors/${id}`, { method: 'PUT', form: fd });
            Object.assign(data.doctors.find((d) => d.id === id), doctor);
            toast('Doctor saved');
          } else {
            const { doctor } = await api('/api/admin/doctors', { method: 'POST', form: fd });
            data.doctors.push(doctor);
            toast('Doctor added');
          }
          render();
        });
      });
      $('[data-del-doc]', form)?.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.delDoc;
        if (!confirm('Remove this doctor from the website?')) return;
        try {
          await api(`/api/admin/doctors/${id}`, { method: 'DELETE' });
          data.doctors = data.doctors.filter((d) => d.id !== id);
          render();
          toast('Doctor removed');
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  /* ------------------------------------------------------------ services */

  function serviceRow(s) {
    return `
      <form class="svc-row" data-svc="${esc(s.id || '')}">
        <div class="svc-img">
          ${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy" />` : ''}
          <label>Change<input type="file" name="image" accept="image/*" /></label>
        </div>
        <div>
          <label class="field"><span>Treatment name</span><input name="title" required maxlength="80" value="${esc(s.title)}" /></label>
          <label class="field"><span>Short description</span><textarea name="desc" rows="2" maxlength="400">${esc(s.desc)}</textarea></label>
        </div>
        <div class="svc-actions">
          <button class="btn sm primary" type="submit">${s.id ? 'Save' : 'Add'}</button>
          ${s.id ? `<button class="btn sm danger" type="button" data-del-svc="${esc(s.id)}">Delete</button>` : ''}
        </div>
      </form>`;
  }

  function renderServices(panel) {
    panel.innerHTML = `
      <div class="panel-head">
        <div><h1>Treatments</h1><p>The picture cards in the “Treatments” section of the website.</p></div>
        <button class="btn ghost" id="addSvc">+ Add treatment</button>
      </div>
      <div class="card">
        <div id="newSvcSlot"></div>
        ${data.services.map(serviceRow).join('')}
      </div>`;

    $('#addSvc').addEventListener('click', () => {
      $('#newSvcSlot').innerHTML = serviceRow({});
      bindServiceRows(panel);
      $('#newSvcSlot input[name=title]').focus();
    });
    bindServiceRows(panel);
  }

  function bindServiceRows(panel) {
    $$('.svc-row', panel).forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = '1';
      form.image.addEventListener('change', () => {
        const f = form.image.files[0];
        if (!f) return;
        const box = $('.svc-img', form);
        $('img', box)?.remove();
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        box.prepend(img);
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        if (!form.image.files.length) fd.delete('image');
        const id = form.dataset.svc;
        withBusy($('button[type=submit]', form), async () => {
          if (id) {
            const { service } = await api(`/api/admin/services/${id}`, { method: 'PUT', form: fd });
            Object.assign(data.services.find((s) => s.id === id), service);
            toast('Treatment saved');
          } else {
            const { service } = await api('/api/admin/services', { method: 'POST', form: fd });
            data.services.push(service);
            toast('Treatment added');
          }
          render();
        });
      });
      $('[data-del-svc]', form)?.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.delSvc;
        if (!confirm('Delete this treatment card?')) return;
        try {
          await api(`/api/admin/services/${id}`, { method: 'DELETE' });
          data.services = data.services.filter((s) => s.id !== id);
          render();
          toast('Treatment deleted');
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  /* ------------------------------------------------------------ settings */

  function renderSettings(panel) {
    const s = data.settings;
    const f = (name, label, opts = {}) => {
      const val = esc(s[name]);
      const input = opts.textarea
        ? `<textarea name="${name}" rows="${opts.rows || 2}" maxlength="600" placeholder="${esc(opts.ph || '')}">${val}</textarea>`
        : `<input name="${name}" value="${val}" maxlength="600" placeholder="${esc(opts.ph || '')}" ${opts.type ? `type="${opts.type}"` : ''} />`;
      return `<label class="field" ${opts.span ? 'style="grid-column:1/-1"' : ''}><span>${label}</span>${input}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
    };
    const waLocal = String(s.whatsapp || '').replace(/^91(?=\d{10}$)/, '');

    panel.innerHTML = `
      <div class="panel-head"><div><h1>Clinic &amp; WhatsApp</h1><p>Contact details and text shown across the website.</p></div></div>
      <form id="settingsForm">
        <div class="card wa-hero">
          <span class="wa-ico">${ICON.wa}</span>
          <div>
            <h2 style="margin-bottom:6px">WhatsApp number</h2>
            <p class="muted" style="margin-bottom:14px">Every WhatsApp button on the website opens a chat with this number.</p>
            <div class="wa-row">
              <label class="field"><span>WhatsApp number</span><input name="whatsapp" inputmode="tel" value="${esc(waLocal)}" placeholder="7588035114" required /><small>10-digit Indian number, or with country code (e.g. 919876543210).</small></label>
              <a class="btn wa" href="https://wa.me/${esc(s.whatsapp)}" target="_blank" rel="noopener" id="waTest">${ICON.wa} Test</a>
            </div>
            <div style="margin-top:14px">${f('whatsappMessage', 'Pre-filled message', { textarea: true, hint: 'The message patients see typed in when they tap a WhatsApp button.' })}</div>
          </div>
        </div>

        <div class="card">
          <h2>Contact &amp; location</h2>
          <div class="grid-2">
            ${f('phone', 'Main phone', { ph: '+91 98905 70728' })}
            ${f('phone2', 'Alternate phone')}
            ${f('email', 'Email', { type: 'email' })}
            ${f('mapQuery', 'Google Maps search text', { hint: 'Used to show the map on the website.' })}
            ${f('mapsLink', 'Google Maps link', { type: 'url', ph: 'https://maps.app.goo.gl/…', hint: 'Used for the "Get directions" button and the WhatsApp confirmation. In Google Maps, tap Share on your clinic and copy the link.' })}
            ${f('address', 'Address (English)', { span: true })}
            ${f('addressLocal', 'Address (Marathi)', { span: true })}
            ${f('hoursWeekdays', 'Clinic hours')}
            ${f('hoursSunday', 'Sunday / holiday hours')}
          </div>
        </div>

        <div class="card">
          <h2>Website text</h2>
          ${f('announcement', 'Announcement bar', { hint: 'Shown at the very top of the website, e.g. “Clinic closed on 15 Aug”. Leave empty to hide it.' })}
          ${f('heroEyebrow', 'Small headline above the title')}
          ${f('heroTitle', 'Main headline')}
          ${f('heroSubtitle', 'Sub-headline', { textarea: true, rows: 3 })}
          <div class="grid-2">
            ${f('clinicName', 'Clinic name')}
            ${f('clinicSubName', 'Clinic name (second line)')}
          </div>
        </div>

        <div class="card">
          <h2>Links</h2>
          <div class="grid-2">
            ${f('googleReviewsUrl', 'Google reviews link', { span: true })}
            ${f('instagram', 'Instagram URL', { ph: 'https://instagram.com/…' })}
            ${f('facebook', 'Facebook URL', { ph: 'https://facebook.com/…' })}
          </div>
        </div>

        <div class="save-bar"><button class="btn primary" type="submit">Save all changes</button></div>
      </form>`;

    const form = $('#settingsForm');
    form.whatsapp.addEventListener('input', () => {
      let d = form.whatsapp.value.replace(/\D/g, '');
      if (d.length === 10) d = `91${d}`;
      $('#waTest').href = `https://wa.me/${d}`;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      withBusy($('button[type=submit]', form), async () => {
        const { settings } = await api('/api/admin/settings', { method: 'PUT', body });
        data.settings = settings;
        toast('Saved. The website is updated.');
        render();
      });
    });
  }

  /* ------------------------------------------------------------ account */

  function renderAccount(panel) {
    panel.innerHTML = `
      <div class="panel-head"><div><h1>Account</h1><p>Logged in as <strong>${esc(data.username)}</strong>.</p></div></div>
      <form class="card" id="pwForm" style="max-width:520px">
        <h2>Change login</h2>
        <label class="field"><span>Username</span><input name="username" value="${esc(data.username)}" maxlength="40" autocomplete="username" /></label>
        <label class="field"><span>Current password</span><input name="current" type="password" required autocomplete="current-password" /></label>
        <label class="field"><span>New password</span><input name="next" type="password" required minlength="8" autocomplete="new-password" /><small>At least 8 characters.</small></label>
        <button class="btn primary" type="submit">Update password</button>
      </form>
      <div class="card" style="max-width:520px;display:flex;gap:10px;flex-wrap:wrap">
        <a href="/" target="_blank" rel="noopener" class="btn ghost">View website ↗</a>
        <button class="btn danger" id="logout2">Log out</button>
      </div>`;

    $('#logout2').addEventListener('click', logout);
    const form = $('#pwForm');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      withBusy($('button[type=submit]', form), async () => {
        await api('/api/admin/password', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        data.username = form.username.value.trim() || data.username;
        data.usingDefaultPassword = false;
        $('#defaultPwWarn').hidden = true;
        toast('Password updated');
        render();
      });
    });
  }

  /* ------------------------------------------------------------ boot */

  showApp().catch(() => showLogin());

  // Refresh appointments every 60s so new bookings show up without reloading.
  setInterval(async () => {
    if ($('#appView').hidden || document.hidden) return;
    try {
      const fresh = await api('/api/admin/data');
      const before = data.appointments.length;
      data.appointments = fresh.appointments;
      updateBadge();
      if (fresh.appointments.length > before) {
        toast('New appointment request received');
        if (currentTab === 'appointments' && !document.activeElement?.matches('input, textarea, select')) render();
      }
    } catch { /* ignore */ }
  }, 60000);
})();
