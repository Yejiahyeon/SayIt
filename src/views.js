'use strict';
const {
  escapeHtml: e,
  formatDate,
  formatDateTime,
  formatTime,
  formatPercent
} = require('./utils');

const icons = {
  bubble: '<path d="M4 6h16v11H10l-6 4z"/>',
  idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1 1 1.6h5c.1-.5.4-1.1 1-1.6A6 6 0 0 0 12 3z"/>',
  calendar: '<path d="M8 3v4M16 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  ballot: '<path d="M9 11l2 2 4-5"/><path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>',
  lock: '<path d="M6 11V8a6 6 0 1 1 12 0v3"/><path d="M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>',
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 6.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM17 4.5a3 3 0 0 1 0 6M21 19v-1a4 4 0 0 0-3-3.8"/>',
  key: '<path d="M10.5 13.5L20 4M17 4h3v3M7.5 12a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>',
  image: '<path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M4 16l4-4 4 4 3-3 5 4"/><circle cx="9" cy="9" r="1.4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  heart: '<path d="M12 21s-7-4.5-9.3-8.2C.9 9.5 2.6 5 7 5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 4.4 0 6.1 4.5 4.3 7.8C19 16.5 12 21 12 21z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'
};

function icon(name, cls) {
  const paths = icons[name] || icons.bubble;
  return `<svg class="icon ${cls || ''}" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function heartIcon(filled) {
  return `<svg class="icon heart-icon" viewBox="0 0 24 24" width="26" height="26" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons.heart}</svg>`;
}

const FLASH_MESSAGES = {
  apothikeutike: { type: 'ok', text: 'Οι αλλαγές αποθηκεύτηκαν με επιτυχία.' },
  diagrafike: { type: 'ok', text: 'Η διαγραφή ολοκληρώθηκε.' },
  dimiourgithike: { type: 'ok', text: 'Η ψηφοφορία δημιουργήθηκε. Είναι κλειστή μέχρι να την ανοίξετε.' },
  anoixe: { type: 'ok', text: 'Η ψηφοφορία άνοιξε. Οι χρήστες μπορούν τώρα να ψηφίσουν.' },
  ekleise: { type: 'ok', text: 'Η ψηφοφορία έκλεισε.' },
  akyrosi_ekdilosis: { type: 'ok', text: 'Η εκδήλωση ακυρώθηκε.' },
  akyrosi_psifismatos: { type: 'ok', text: 'Η ψηφοφορία ακυρώθηκε.' },
  parachorisi: { type: 'ok', text: 'Η άδεια διαχείρισης παραχωρήθηκε στον λογαριασμό.' },
  afairesi: { type: 'ok', text: 'Η άδεια διαχείρισης αφαιρέθηκε αμέσως από τον λογαριασμό.' },
  kodikos: { type: 'ok', text: 'Ο κωδικός πρόσβασης άλλαξε.' },
  eggrafi: { type: 'ok', text: 'Ο λογαριασμός δημιουργήθηκε. Καλώς ήρθες!' },
  sfalma: { type: 'error', text: 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.' }
};

function flashHtml(code) {
  const f = FLASH_MESSAGES[code];
  if (!f) return '';
  return `<div class="flash flash-${f.type}">${e(f.text)}</div>`;
}

function pagerHtml(pager, basePath) {
  if (!pager || pager.pages <= 1) return '';
  const href = page => page === 1 ? basePath : basePath + '?page=' + page;
  const previous = pager.page > 1
    ? `<a class="btn btn-secondary" href="${href(pager.page - 1)}" rel="prev">← Προηγούμενη</a>`
    : '<span class="btn btn-secondary is-disabled" aria-hidden="true">← Προηγούμενη</span>';
  const next = pager.page < pager.pages
    ? `<a class="btn btn-secondary" href="${href(pager.page + 1)}" rel="next">Επόμενη →</a>`
    : '<span class="btn btn-secondary is-disabled" aria-hidden="true">Επόμενη →</span>';
  return `<nav class="pagination" aria-label="Σελίδες αποτελεσμάτων">
    ${previous}
    <span class="pagination-info">Σελίδα ${pager.page} από ${pager.pages}</span>
    ${next}
  </nav>`;
}

function roleLabel(user) {
  if (user.is_owner) return 'Ιδιοκτήτης';
  if (user.is_manager) return 'Διαχειριστής';
  return 'Απλός χρήστης';
}

function managementEntry(user) {
  if (!user) return '';
  if (user.is_owner) {
    return `<a class="header-link" href="/symvoulio">Περιοχή διαχείρισης</a>`;
  }
  if (user.is_manager) {
    return `<a class="header-link" href="/symvoulio/ekdiloseis">Εργαλεία διαχείρισης</a>`;
  }
  return '';
}

function head(title) {
  return `<!doctype html>
<html lang="el">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(title)} — Πες το</title>
<meta name="theme-color" content="#1f7ae0">
<meta name="application-name" content="Πες το">
<meta name="apple-mobile-web-app-title" content="Πες το">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/style.css">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='24' fill='%231f7ae0'/%3E%3Cpath d='M25 28h50v34H52L36 74V62h-11z' fill='white'/%3E%3C/svg%3E">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
</head>`;
}

function publicHeader(user) {
  const actions = user ? managementEntry(user) : '';
  return `<header class="site-header">
  <a class="brand" href="/">
    <span class="brand-badge">${icon('bubble')}</span>
    <span class="brand-name bubble-text">Πες το</span>
  </a>
  ${actions ? `<div class="header-actions">${actions}</div>` : ''}
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <p class="footer-note">Πες το — η φωνή των μαθητών του σχολείου μας</p>
</footer>
<script src="/app.js"></script>
</body>
</html>`;
}

function layout({ title, content, user }) {
  return `${head(title)}
<body class="page">
${publicHeader(user)}
<main class="container">
${content}
</main>
${footer()}`;
}

function councilLayout({ title, content, user, active, flash }) {
  const items = [];
  if (user.is_owner) items.push(['episkopisi', 'Επισκόπηση', '/symvoulio']);
  items.push(
    ['ekdiloseis', 'Εκδηλώσεις', '/symvoulio/ekdiloseis'],
    ['psifismata', 'Ψηφοφορίες', '/symvoulio/psifismata']
  );
  if (user.is_owner) items.push(['prosvasi', 'Διαχείριση πρόσβασης', '/symvoulio/prosvasi']);
  const nav = items.map(([key, label, href]) =>
    `<a class="council-nav-link ${active === key ? 'is-active' : ''}" href="${href}">${e(label)}</a>`
  ).join('');
  const areaLabel = user.is_owner ? 'Περιοχή διαχείρισης' : 'Εργαλεία διαχείρισης';
  return `${head(title)}
<body class="page">
<header class="site-header council-header">
  <a class="brand" href="/">
    <span class="brand-badge">${icon('bubble')}</span>
    <span class="brand-name bubble-text">Πες το</span>
  </a>
</header>
<nav class="council-nav" aria-label="Μενού διαχείρισης">
  <div class="council-nav-inner">${nav}</div>
</nav>
<main class="container">
  <p class="council-tag">${areaLabel}</p>
  <h1 class="page-title">${e(title)}</h1>
  ${flashHtml(flash)}
  ${content}
</main>
<footer class="site-footer">
  <p class="footer-note">Πες το — ${user.is_owner ? 'περιοχή διαχείρισης' : 'εργαλεία διαχείρισης'}</p>
</footer>
<script src="/app.js"></script>
</body>
</html>`;
}

function home({ user, openCount, flash }) {
  const voteCard = openCount > 0
    ? `
    <a class="action-card action-vote" href="/psifos">
      <span class="action-icon">${icon('ballot')}</span>
      <span class="action-text">
        <span class="action-title">Ψηφίστε</span>
        <span class="action-sub">Υπάρχει ανοιχτή ψηφοφορία — πες τη γνώμη σου!</span>
      </span>
    </a>`
    : '';
  return layout({
    user,
    title: 'Αρχική',
    content: `
    <section class="hero">
      <h1 class="hero-title bubble-text">Πες το</h1>
      <p class="hero-sub">Η φωνή σου μετράει! Πρότεινε ιδέες, μάθε για τις εκδηλώσεις και ψήφισε.</p>
    </section>
    ${flashHtml(flash)}
    <section class="action-list">
      <a class="action-card" href="/protasi">
        <span class="action-icon">${icon('idea')}</span>
        <span class="action-text">
          <span class="action-title">Πρότεινε μια δραστηριότητα</span>
          <span class="action-sub">Έχεις μια ιδέα; Στείλε την στο συμβούλιο!</span>
        </span>
      </a>
      <a class="action-card" href="/ekdiloseis">
        <span class="action-icon">${icon('calendar')}</span>
        <span class="action-text">
          <span class="action-title">Επερχόμενες εκδηλώσεις</span>
          <span class="action-sub">Δες τι έρχεται στο σχολείο μας</span>
        </span>
      </a>
      ${voteCard}
    </section>`
  });
}

function suggestPage({ user, values = {}, errors = [] }) {
  const categoryOptions = require('./db').SUGGESTION_CATEGORIES
    .map(c => `<option value="${e(c)}" ${values.category === c ? 'selected' : ''}>${e(c)}</option>`)
    .join('');
  const errorsHtml = errors.length
    ? `<div class="flash flash-error"><ul class="error-list">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  return layout({
    user,
    title: 'Πρότεινε μια δραστηριότητα',
    content: `
    <h1 class="page-title">Πρότεινε μια δραστηριότητα</h1>
    <p class="lead">Τι είδους δραστηριότητα θέλετε να προτείνετε;</p>
    ${errorsHtml}
    <form method="post" action="/protasi" class="card form-card" novalidate>
      <div class="field">
        <label for="category">Κατηγορία</label>
        <select id="category" name="category" required>
          <option value="">— Επιλέξτε κατηγορία —</option>
          ${categoryOptions}
        </select>
      </div>
      <div class="field">
        <label for="title">Τίτλος</label>
        <input id="title" name="title" type="text" maxlength="120" required
               placeholder="π.χ. Τουρνουά ποδοσφαίρου" value="${e(values.title || '')}">
      </div>
      <div class="field">
        <label for="description">Περιγραφή</label>
        <textarea id="description" name="description" rows="5" maxlength="2000" required
                  placeholder="Γράψε σύντομα την ιδέα σου…">${e(values.description || '')}</textarea>
      </div>
      <button type="submit" class="btn btn-primary btn-block">${icon('check')} Υποβολή πρότασης</button>
      <p class="form-note">${icon('users')} Η πρότασή σου θα είναι ορατή σε όλους τους μαθητές στη σελίδα «Δείτε τις προτάσεις». Μην γράφεις προσωπικά στοιχεία.</p>
    </form>
    <div class="toolbar suggestion-nav">
      <a class="btn btn-secondary" href="/protaseis">${icon('heart')} Δείτε τις προτάσεις</a>
    </div>`
  });
}

function suggestSuccess({ user }) {
  return layout({
    user,
    title: 'Ευχαριστούμε!',
    content: `
    <div class="card center-card">
      <div class="big-icon big-icon-ok">${icon('checkCircle')}</div>
      <h1 class="page-title">Ευχαριστούμε!</h1>
      <p class="lead">Η πρότασή σου καταχωρίστηκε και θα εμφανιστεί δημόσια σε όλους τους μαθητές στη σελίδα «Δείτε τις προτάσεις».</p>
      <div class="quick-actions quick-actions-center">
        <a class="btn btn-primary" href="/protaseis">${icon('heart')} Δείτε τις προτάσεις</a>
        <a class="btn btn-secondary" href="/">Επιστροφή στην αρχική</a>
      </div>
    </div>`
  });
}

function suggestionBoardPage({ user, suggestions, pager }) {
  const list = suggestions.length
    ? suggestions.map(s => {
      const count = Number(s.like_count) || 0;
      const liked = Number(s.liked) === 1;
      const likeLabel = (liked ? 'Αφαίρεση της προτίμησης' : 'Μου αρέσει') +
        ' — ' + count + (count === 1 ? ' προτίμηση' : ' προτιμήσεις');
      return `
      <article class="card suggestion-card public-suggestion" id="protasi-${Number(s.id)}">
        <div class="suggestion-head">
          <span class="badge badge-cat">${e(s.category)}</span>
          <span class="suggestion-date">${e(formatDateTime(s.created_at))}</span>
        </div>
        <h2 class="suggestion-title">${e(s.title)}</h2>
        <p class="suggestion-desc">${e(s.description).replaceAll('\n', '<br>')}</p>
        <form method="post" action="/protaseis/${Number(s.id)}/mou-aresei" class="like-form">
          <button type="submit" class="like-button ${liked ? 'is-liked' : ''}"
                  aria-label="${e(likeLabel)}" aria-pressed="${liked ? 'true' : 'false'}">
            ${heartIcon(liked)}
          </button>
        </form>
      </article>`;
    }).join('')
    : `
    <div class="card empty-card">
      <div class="big-icon">${icon('heart')}</div>
      <p>Δεν υπάρχουν ακόμα δημόσιες προτάσεις.</p>
    </div>`;
  return layout({
    user,
    title: 'Δείτε τις προτάσεις',
    content: `
    <h1 class="page-title">Δείτε τις προτάσεις</h1>
    <p class="lead">Οι δημόσιες προτάσεις των μαθητών. Πάτησε την καρδιά για να δείξεις τη στήριξή σου.</p>
    <div class="suggestion-list">${list}</div>
    ${pagerHtml(pager, '/protaseis')}`
  });
}

function eventsPage({ user, events, pager }) {
  const isOwner = !!user && user.is_owner;
  const list = events.length
    ? events.map(ev => {
      const detailAttrs = isOwner
        ? ` tabindex="0" role="group" data-detail-url="/symvoulio/ekdiloseis/${Number(ev.id)}" aria-label="Λεπτομέρειες και διαχείριση εκδήλωσης: ${e(ev.title)}"`
        : '';
      return `
      <article class="card event-card${isOwner ? ' owner-detail-card' : ''}"${detailAttrs}>
        ${ev.image_path ? `<img class="event-image" src="/uploads/${e(ev.image_path)}" alt="${e(ev.title)}">` : ''}
        <div class="event-body">
          <h2 class="event-title">${e(ev.title)}</h2>
          <p class="event-meta">${icon('calendar')} ${e(formatDate(ev.event_date))}</p>
          <p class="event-meta">${icon('clock')} ${e(formatTime(ev.event_time))}</p>
          <p class="event-meta">${icon('pin')} ${e(ev.location)}</p>
          <p class="event-desc">${e(ev.description)}</p>
        </div>
      </article>`;
    }).join('')
    : `
      <div class="card empty-card">
        <div class="big-icon">${icon('calendar')}</div>
        <p>Δεν υπάρχουν ακόμα εκδηλώσεις.</p>
      </div>`;
  return layout({
    user,
    title: 'Επερχόμενες εκδηλώσεις',
    content: `
    <h1 class="page-title">Επερχόμενες εκδηλώσεις</h1>
    ${user && user.can_manage ? `<div class="toolbar"><a class="btn btn-primary" href="/symvoulio/ekdiloseis/nea">+ Νέο</a></div>` : ''}
    <div class="event-list">${list}</div>
    ${pagerHtml(pager, '/ekdiloseis')}`
  });
}

function voteListPage({ user, polls, pager }) {
  const open = polls.filter(p => p.status === 'open');
  const isOwner = !!user && user.is_owner;
  const list = open.length
    ? open.map(p => {
      const content = `
        <span class="action-icon">${icon('ballot')}</span>
        <span class="action-text">
          <span class="action-title">${e(p.question)}</span>
          <span class="action-sub">Ψήφισε τώρα — τα αποτελέσματα εμφανίζονται μετά την ψήφο σου.</span>
        </span>`;
      if (isOwner) {
        return `
      <article class="card poll-card owner-detail-card" tabindex="0" role="group"
               data-detail-url="/symvoulio/psifismata/${Number(p.id)}"
               aria-label="Ψηφοφορία: ${e(p.question)}. Διπλό κλικ για λεπτομέρειες και διαχείριση.">
        <a class="poll-card-link" data-detail-single-click href="/psifos/${Number(p.id)}">${content}</a>
      </article>`;
      }
      return `
      <a class="card poll-card" href="/psifos/${Number(p.id)}">${content}</a>`;
    }).join('')
    : `
      <div class="card empty-card">
        <div class="big-icon">${icon('ballot')}</div>
        <p>Δεν υπάρχει ενεργή ψηφοφορία αυτή τη στιγμή.</p>
      </div>`;
  return layout({
    user,
    title: 'Ψηφίστε',
    content: `
    <h1 class="page-title">Ψηφίστε</h1>
    <p class="lead">Ενεργές ψηφοφορίες του συμβουλίου</p>
    <div class="action-list">${list}</div>
    ${pagerHtml(pager, '/psifos')}`
  });
}

function choicesHtml(choices, checkedId) {
  return choices.map(ch => `
    <label class="choice-card ${checkedId === Number(ch.id) ? 'is-checked' : ''}">
      <input type="radio" name="choice" value="${Number(ch.id)}" ${checkedId === Number(ch.id) ? 'checked' : ''}>
      <span class="choice-content">
        ${ch.image_path ? `<img class="choice-image" src="/uploads/${e(ch.image_path)}" alt="${e(ch.text || 'Επιλογή')}">` : ''}
        ${ch.text ? `<span class="choice-text">${e(ch.text)}</span>` : ''}
      </span>
      <span class="choice-check">${icon('checkCircle')}</span>
    </label>`).join('');
}

function pollVotePage({ user, poll, choices, errors = [], values = {}, pollClosed = false }) {
  const errorsHtml = errors.length
    ? `<div class="flash flash-error"><ul class="error-list">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  if (pollClosed) {
    return layout({
      user,
      title: 'Ψηφοφορία',
      content: `
      <h1 class="page-title">${e(poll.question)}</h1>
      ${errorsHtml}
      <div class="card center-card">
        <div class="big-icon">${icon('lock')}</div>
        <p class="lead">Η ψηφοφορία έχει κλείσει.</p>
        <p>Τα αποτελέσματα εμφανίζονται μόνο σε λογαριασμούς που έχουν ψηφίσει.</p>
        <a class="btn btn-secondary" href="/">Επιστροφή στην αρχική</a>
      </div>`
    });
  }
  return layout({
    user,
    title: 'Ψηφίστε',
    content: `
    <h1 class="page-title">${e(poll.question)}</h1>
    <p class="lead">Διάλεξε μία επιλογή. Κάθε λογαριασμός ψηφίζει μία φορά σε κάθε ψηφοφορία.</p>
    ${errorsHtml}
    <form method="post" action="/psifos/${Number(poll.id)}" class="poll-form">
      <div class="choice-list">${choicesHtml(choices, Number(values.choice) || 0)}</div>
      <button type="submit" class="btn btn-primary btn-block">${icon('ballot')} Καταχώριση ψήφου</button>
    </form>`
  });
}

function resultsHtml({ poll, results, justVoted, canRefresh }) {
  const rows = results.rows.map(r => `
    <div class="result-row">
      ${r.image_path ? `<img class="choice-image" src="/uploads/${e(r.image_path)}" alt="${e(r.text || 'Επιλογή')}">` : ''}
      <div class="result-main">
        <div class="result-head">
          <span class="result-text">${e(r.text || 'Επιλογή με εικόνα')}</span>
          <span class="result-numbers"><strong id="count-${r.id}">${r.count}</strong> ψήφοι · <span id="pct-${r.id}">${e(formatPercent(r.count, results.total))}</span></span>
        </div>
        <div class="bar"><span id="bar-${r.id}" style="width:${results.total ? (r.count / results.total * 100) : 0}%"></span></div>
      </div>
    </div>`).join('');
  return `
    ${justVoted ? `<div class="flash flash-ok">${icon('checkCircle')} Η ψήφος σας καταχωρίστηκε με επιτυχία! Ορίστε τα αποτελέσματα:</div>` : ''}
    <div class="card results-card">
      <h2 class="section-title">Αποτελέσματα</h2>
      <div id="results-body">${rows}</div>
      <p class="total-votes">Σύνολο ψήφων: <strong id="total">${results.total}</strong></p>
      ${canRefresh ? `
      <button type="button" id="refresh-results" class="btn btn-secondary btn-block" data-poll-id="${Number(poll.id)}">
        ${icon('refresh')} Ανανέωση αποτελεσμάτων
      </button>
      <p class="field-hint" id="refresh-status" role="status"></p>` : ''}
    </div>`;
}

function pollResultsPage({ user, poll, results, justVoted }) {
  const refreshScript = `
<script>
(function () {
  var btn = document.getElementById('refresh-results');
  if (!btn) return;
  var status = document.getElementById('refresh-status');
  btn.addEventListener('click', function () {
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.textContent = 'Ανανέωση…';
    if (status) status.textContent = '';
    fetch('/psifos/' + btn.dataset.pollId + '/apotelesmata.json', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('fail'); return r.json(); })
      .then(function (data) {
        data.choices.forEach(function (c) {
          var count = document.getElementById('count-' + c.id);
          var pct = document.getElementById('pct-' + c.id);
          var bar = document.getElementById('bar-' + c.id);
          if (count) count.textContent = c.count;
          if (pct) pct.textContent = c.percent;
          if (bar) bar.style.width = c.bar + '%';
        });
        var total = document.getElementById('total');
        if (total) total.textContent = data.total;
        if (status) status.textContent = 'Τα αποτελέσματα ενημερώθηκαν: ' + data.time;
      })
      .catch(function () {
        if (status) status.textContent = 'Δεν ήταν δυνατή η ανανέωση. Δοκιμάστε ξανά.';
      })
      .finally(function () {
        btn.disabled = false;
        btn.innerHTML = original;
      });
  });
})();
</script>`;
  return layout({
    user,
    title: 'Αποτελέσματα',
    content: `
    <h1 class="page-title">${e(poll.question)}</h1>
    ${resultsHtml({ poll, results, justVoted, canRefresh: true })}
    ${refreshScript}`
  });
}

function errorPage({ title = 'Σφάλμα', message, user }) {
  return layout({
    title,
    user,
    content: `
    <div class="card center-card">
      <div class="big-icon big-icon-warn">${icon('bubble')}</div>
      <h1 class="page-title">${e(title)}</h1>
      <p class="lead">${e(message)}</p>
      <a class="btn btn-primary" href="/">Επιστροφή στην αρχική</a>
    </div>`
  });
}

function forbiddenPage({ user }) {
  return errorPage({
    user,
    title: 'Δεν επιτρέπεται η πρόσβαση',
    message: 'Δεν έχετε δικαίωμα πρόσβασης σε αυτή τη σελίδα.'
  });
}

function notFoundPage({ user }) {
  return errorPage({ title: 'Η σελίδα δεν βρέθηκε', message: 'Η σελίδα που ζητήσατε δεν υπάρχει.', user });
}

function authLayout({ title, content }) {
  return `${head(title)}
<body class="page auth-page">
<main class="auth-shell">
  <div class="auth-brand">
    <span class="brand-badge auth-brand-badge">${icon('bubble')}</span>
    <h1 class="auth-title bubble-text">Πες το</h1>
    <p class="auth-tagline">Η φωνή σου μετράει! Συνδέσου ή δημιούργησε λογαριασμό για να συνεχίσεις.</p>
  </div>
  ${content}
  <footer class="site-footer auth-footer">
    <p class="footer-note">Πες το — η φωνή των μαθητών του σχολείου μας</p>
  </footer>
</main>
<script src="/app.js"></script>
</body>
</html>`;
}

function entryPage({
  loginError = '',
  next = '/',
  registerErrors = [],
  focus = 'login'
}) {
  const registerErrorsHtml = registerErrors.length
    ? `<div class="flash flash-error"><ul class="error-list">${registerErrors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  const loginAutofocus = focus === 'login' ? ' autofocus' : '';
  const registerAutofocus = focus === 'register' ? ' autofocus' : '';
  return authLayout({
    title: 'Σύνδεση ή εγγραφή',
    content: `
    <div class="auth-grid">
      <section class="card auth-panel" id="syndesi" aria-labelledby="login-title">
        <h2 class="auth-panel-title" id="login-title">Σύνδεση</h2>
        <p class="auth-panel-sub">Συνδέσου με το ψευδώνυμο και τον κωδικό πρόσβασής σου.</p>
        ${loginError ? `<div class="flash flash-error">${e(loginError)}</div>` : ''}
        <form method="post" action="/syndesi" class="auth-form">
          <input type="hidden" name="next" value="${e(next)}">
          <div class="field">
            <label for="login_username">Όνομα χρήστη</label>
            <input id="login_username" name="username" type="text" autocomplete="username"
                   maxlength="30" required${loginAutofocus}>
          </div>
          <div class="field">
            <label for="login_password">Κωδικός πρόσβασης</label>
            <input id="login_password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary btn-block">${icon('lock')} Σύνδεση</button>
        </form>
      </section>

      <section class="card auth-panel" id="eggrafi" aria-labelledby="register-title">
        <h2 class="auth-panel-title" id="register-title">Εγγραφή</h2>
        <p class="auth-panel-sub">Διάλεξε ένα μοναδικό ψευδώνυμο, όχι πραγματικό όνομα ή ηλεκτρονικό ταχυδρομείο.</p>
        ${registerErrorsHtml}
        <form method="post" action="/eggrafi" class="auth-form">
          <div class="field">
            <label for="register_username">Όνομα χρήστη</label>
            <input id="register_username" name="username" type="text" autocomplete="username"
                   maxlength="30" required${registerAutofocus}>
            <p class="field-hint">3–30 χαρακτήρες: γράμματα, αριθμοί, κενά, τελείες, παύλες ή κάτω παύλες.</p>
          </div>
          <div class="field">
            <label for="register_password">Κωδικός πρόσβασης</label>
            <input id="register_password" name="password" type="password" autocomplete="new-password" minlength="8" required>
            <p class="field-hint">Τουλάχιστον 8 χαρακτήρες.</p>
          </div>
          <div class="field">
            <label for="register_confirm">Επιβεβαίωση κωδικού πρόσβασης</label>
            <input id="register_confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required>
          </div>
          <button type="submit" class="btn btn-primary btn-block">${icon('users')} Εγγραφή</button>
          <p class="form-note">Οι νέοι λογαριασμοί είναι πάντα απλοί χρήστες. Δεν μπορείτε να επιλέξετε ρόλο διαχείρισης.</p>
        </form>
      </section>
    </div>`
  });
}

function dashboardPage({ user, counts, flash }) {
  return councilLayout({
    title: 'Επισκόπηση',
    user,
    active: 'episkopisi',
    flash,
    content: `
    <div class="stat-grid">
      <a class="card stat-card" href="/symvoulio/ekdiloseis">
        <span class="stat-number">${counts.events}</span>
        <span class="stat-label">${icon('calendar')} Επερχόμενες εκδηλώσεις</span>
      </a>
      <a class="card stat-card" href="/symvoulio/psifismata">
        <span class="stat-number">${counts.openPolls} / ${counts.polls}</span>
        <span class="stat-label">${icon('ballot')} Ανοιχτές / όλες οι ψηφοφορίες</span>
      </a>
    </div>
    ${user.is_owner ? `
    <div class="card">
      <h2 class="section-title">Πρόσβαση</h2>
      <p class="form-note">${icon('shield')} Μόνο ο ιδιοκτήτης μπορεί να παραχωρεί ή να αφαιρεί δικαιώματα διαχείρισης.</p>
      <a class="btn btn-secondary" href="/symvoulio/prosvasi">Διαχείριση πρόσβασης</a>
    </div>` : ''}`
  });
}

function eventsAdminPage({ user, events, pager, flash }) {
  const list = events.length
    ? events.map(ev => {
      const detailAttrs = user.is_owner
        ? ` tabindex="0" role="group" data-detail-url="/symvoulio/ekdiloseis/${Number(ev.id)}" aria-label="Λεπτομέρειες και διαχείριση εκδήλωσης: ${e(ev.title)}"`
        : '';
      return `
      <article class="card admin-event-card${user.is_owner ? ' owner-detail-card' : ''}"${detailAttrs}>
        <div class="admin-event-main">
          ${ev.image_path ? `<img class="event-image small" src="/uploads/${e(ev.image_path)}" alt="">` : ''}
          <div>
            <h2 class="event-title">${e(ev.title)}</h2>
            <p class="event-meta">${icon('calendar')} ${e(formatDate(ev.event_date))} · ${icon('clock')} ${e(formatTime(ev.event_time))}</p>
            <p class="event-meta">${icon('pin')} ${e(ev.location)}</p>
          </div>
        </div>
        <div class="admin-event-actions">
          <a class="btn btn-secondary" href="/symvoulio/ekdiloseis/${Number(ev.id)}/epexergasia">${icon('edit')} Επεξεργασία</a>
          <form method="post" action="/symvoulio/ekdiloseis/${Number(ev.id)}/diagrafi" class="inline-form"
                onsubmit="return confirm('Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή την εκδήλωση;');">
            <button type="submit" class="btn btn-danger">${icon('trash')} Διαγραφή</button>
          </form>
        </div>
      </article>`;
    }).join('')
    : `
      <div class="card empty-card">
        <div class="big-icon">${icon('calendar')}</div>
        <p>Δεν υπάρχουν ακόμα εκδηλώσεις.</p>
      </div>`;
  return councilLayout({
    title: 'Διαχείριση εκδηλώσεων',
    user,
    active: 'ekdiloseis',
    flash,
    content: `
    <div class="toolbar">
      <a class="btn btn-primary" href="/symvoulio/ekdiloseis/nea">+ Νέο</a>
    </div>
    ${list}
    ${pagerHtml(pager, '/symvoulio/ekdiloseis')}`
  });
}

function eventFormPage({ user, event, errors = [], mode }) {
  const isEdit = mode === 'edit';
  const action = isEdit ? `/symvoulio/ekdiloseis/${Number(event.id)}` : '/symvoulio/ekdiloseis';
  const errorsHtml = errors.length
    ? `<div class="flash flash-error"><ul class="error-list">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  return councilLayout({
    title: isEdit ? 'Επεξεργασία εκδήλωσης' : 'Νέα εκδήλωση',
    user,
    active: 'ekdiloseis',
    content: `
    ${errorsHtml}
    <form method="post" action="${action}" class="card form-card" enctype="multipart/form-data">
      <div class="field">
        <label for="title">Τίτλος</label>
        <input id="title" name="title" type="text" maxlength="150" required value="${e(event.title || '')}">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="event_date">Ημερομηνία</label>
          <input id="event_date" name="event_date" type="date" required value="${e(event.event_date || '')}">
        </div>
        <div class="field">
          <label for="event_time">Ώρα</label>
          <input id="event_time" name="event_time" type="time" required value="${e(event.event_time || '')}">
        </div>
      </div>
      <div class="field">
        <label for="location">Τοποθεσία</label>
        <input id="location" name="location" type="text" maxlength="150" required value="${e(event.location || '')}">
      </div>
      <div class="field">
        <label for="description">Σημειώσεις</label>
        <textarea id="description" name="description" rows="4" maxlength="2000" required>${e(event.description || '')}</textarea>
      </div>
      <div class="field">
        <label for="image">Εικόνα (προαιρετικά)</label>
        <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <p class="field-hint">Αποδεκτά: JPG, PNG, WEBP, GIF — έως 3MB.</p>
      </div>
      ${isEdit && event.image_path ? `
      <div class="field">
        <img class="event-image small" src="/uploads/${e(event.image_path)}" alt="Τρέχουσα εικόνα">
        <label class="checkbox-label">
          <input type="checkbox" name="remove_image" value="1"> Διαγραφή τρέχουσας εικόνας
        </label>
      </div>` : ''}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${icon('check')} Αποθήκευση</button>
        <a class="btn btn-secondary" href="/symvoulio/ekdiloseis">Ακύρωση</a>
      </div>
    </form>`
  });
}

function eventDetailPage({ user, event, flash }) {
  const cancelled = !!event.cancelled_at;
  return councilLayout({
    title: 'Λεπτομέρειες εκδήλωσης',
    user,
    active: 'ekdiloseis',
    flash,
    content: `
    <div class="card event-detail-card">
      ${event.image_path ? `<img class="event-image" src="/uploads/${e(event.image_path)}" alt="${e(event.title)}">` : ''}
      <div class="event-body">
        <p class="event-meta">
          <span class="badge ${cancelled ? 'badge-cancelled' : 'badge-open'}">${cancelled ? 'Ακυρωμένη' : 'Δημοσιευμένη'}</span>
        </p>
        <h2 class="event-title">${e(event.title)}</h2>
        <p class="event-meta">${icon('calendar')} ${e(formatDate(event.event_date))} · ${icon('clock')} ${e(formatTime(event.event_time))}</p>
        <p class="event-meta">${icon('pin')} ${e(event.location)}</p>
        <p class="event-desc">${e(event.description)}</p>
      </div>
    </div>
    <div class="card">
      <h2 class="section-title">Ενέργειες</h2>
      <div class="quick-actions">
        <a class="btn btn-secondary" href="/symvoulio/ekdiloseis/${Number(event.id)}/epexergasia">${icon('edit')} Επεξεργασία</a>
        ${user.is_owner && !cancelled ? `
        <form method="post" action="/symvoulio/ekdiloseis/${Number(event.id)}/akyrosi" class="inline-form"
              onsubmit="return confirm('Θέλετε σίγουρα να ακυρώσετε αυτή την εκδήλωση;');">
          <button type="submit" class="btn btn-danger">${icon('trash')} Ακύρωση εκδήλωσης</button>
        </form>` : ''}
        <form method="post" action="/symvoulio/ekdiloseis/${Number(event.id)}/diagrafi" class="inline-form"
              onsubmit="return confirm('Είστε σίγουροι ότι θέλετε να διαγράψετε αυτή την εκδήλωση;');">
          <button type="submit" class="btn btn-danger">${icon('trash')} Διαγραφή</button>
        </form>
      </div>
      ${cancelled ? `<p class="form-note">${icon('lock')} Η εκδήλωση έχει ακυρωθεί και δεν εμφανίζεται στις δημόσιες εκδηλώσεις.</p>` : ''}
    </div>`
  });
}

function pollsAdminPage({ user, polls, pager, flash }) {
  const list = polls.length
    ? polls.map(p => {
      const detailAttrs = user.is_owner
        ? ` tabindex="0" role="group" data-detail-url="/symvoulio/psifismata/${Number(p.id)}" aria-label="Λεπτομέρειες και διαχείριση ψηφοφορίας: ${e(p.question)}"`
        : '';
      return `
      <article class="card admin-poll-card${user.is_owner ? ' owner-detail-card' : ''}"${detailAttrs}>
        <div class="admin-event-main">
          <div>
            <h2 class="event-title">${e(p.question)}</h2>
            <p class="event-meta">
              <span class="badge ${p.status === 'open' ? 'badge-open' : 'badge-closed'}">${p.status === 'open' ? 'Ανοιχτή' : 'Κλειστή'}</span>
              ${e(p.choices_count)} επιλογές · ${e(p.votes_count)} ψήφοι
            </p>
          </div>
        </div>
        <div class="admin-event-actions">
          <a class="btn btn-secondary" href="/symvoulio/psifismata/${Number(p.id)}">${icon('ballot')} Προβολή</a>
        </div>
      </article>`;
    }).join('')
    : `
      <div class="card empty-card">
        <div class="big-icon">${icon('ballot')}</div>
        <p>Δεν υπάρχουν ακόμα ψηφοφορίες.</p>
      </div>`;
  return councilLayout({
    title: 'Ψηφοφορίες',
    user,
    active: 'psifismata',
    flash,
    content: `
    <div class="toolbar">
      <a class="btn btn-primary" href="/symvoulio/psifismata/nea">+ Νέο</a>
    </div>
    ${list}
    ${pagerHtml(pager, '/symvoulio/psifismata')}`
  });
}

function pollFormPage({ user, errors = [], values = {} }) {
  const errorsHtml = errors.length
    ? `<div class="flash flash-error"><ul class="error-list">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  const initial = (values.choice_texts && values.choice_texts.length ? values.choice_texts : ['', '']);
  const rows = initial.map((text, i) => `
      <div class="choice-row" data-choice-row>
        <div class="choice-row-head">
          <span class="choice-num">Επιλογή</span>
          <button type="button" class="btn-link remove-choice" aria-label="Αφαίρεση επιλογής">${icon('trash')} Αφαίρεση</button>
        </div>
        <div class="field">
          <label>Κείμενο επιλογής</label>
          <input type="text" name="choice_text_${i}" maxlength="150" value="${e(text)}" placeholder="π.χ. Ποδόσφαιρο">
        </div>
        <div class="field">
          <label>Εικόνα (προαιρετικά)</label>
          <input type="file" name="choice_image_${i}" accept="image/jpeg,image/png,image/webp,image/gif">
        </div>
      </div>`).join('');
  return councilLayout({
    title: 'Νέα ψηφοφορία',
    user,
    active: 'psifismata',
    content: `
    <p class="lead">Γράψε την ερώτηση και πρόσθεσε τουλάχιστον 2 επιλογές, με κείμενο ή εικόνα.</p>
    ${errorsHtml}
    <form method="post" action="/symvoulio/psifismata" class="card form-card" enctype="multipart/form-data" id="poll-form">
      <div class="field">
        <label for="question">Ερώτηση</label>
        <input id="question" name="question" type="text" maxlength="300" required
               placeholder="π.χ. Ποια δραστηριότητα προτιμάτε για την επόμενη συνάντηση;" value="${e(values.question || '')}">
      </div>
      <div id="choices-container">${rows}</div>
      <button type="button" class="btn btn-secondary" id="add-choice">${icon('plus')} Προσθήκη επιλογής</button>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${icon('check')} Δημιουργία ψηφοφορίας</button>
        <a class="btn btn-secondary" href="/symvoulio/psifismata">Άκυρο</a>
      </div>
      <p class="form-note">${icon('lock')} Η ψηφοφορία δημιουργείται κλειστή. Ανοίξτε την όταν είστε έτοιμοι.</p>
    </form>
    <template id="choice-template">
      <div class="choice-row" data-choice-row>
        <div class="choice-row-head">
          <span class="choice-num">Επιλογή</span>
          <button type="button" class="btn-link remove-choice" aria-label="Αφαίρεση επιλογής">${icon('trash')} Αφαίρεση</button>
        </div>
        <div class="field">
          <label>Κείμενο επιλογής</label>
          <input type="text" name="choice_text___IDX__" maxlength="150" placeholder="π.χ. Ποδόσφαιρο">
        </div>
        <div class="field">
          <label>Εικόνα (προαιρετικά)</label>
          <input type="file" name="choice_image___IDX__" accept="image/jpeg,image/png,image/webp,image/gif">
        </div>
      </div>
    </template>
    <script>
    (function () {
      var container = document.getElementById('choices-container');
      var template = document.getElementById('choice-template');
      var addBtn = document.getElementById('add-choice');
      var nextIndex = ${initial.length};
      function updateNumbers() {
        var rows = container.querySelectorAll('[data-choice-row]');
        rows.forEach(function (row, i) {
          row.querySelector('.choice-num').textContent = 'Επιλογή ' + (i + 1);
          var remove = row.querySelector('.remove-choice');
          remove.disabled = rows.length <= 2;
        });
      }
      addBtn.addEventListener('click', function () {
        if (container.querySelectorAll('[data-choice-row]').length >= 10) return;
        var html = template.innerHTML.replaceAll('__IDX__', String(nextIndex++));
        container.insertAdjacentHTML('beforeend', html);
        updateNumbers();
      });
      container.addEventListener('click', function (event) {
        var btn = event.target.closest('.remove-choice');
        if (!btn) return;
        if (container.querySelectorAll('[data-choice-row]').length <= 2) return;
        btn.closest('[data-choice-row]').remove();
        updateNumbers();
      });
      updateNumbers();
    })();
    </script>`
  });
}

function pollAdminPage({ user, poll, results, flash }) {
  const cancelled = poll.status === 'cancelled' || !!poll.cancelled_at;
  const statusBadge = cancelled
    ? `<span class="badge badge-cancelled">Ακυρωμένη</span>`
    : `<span class="badge ${poll.status === 'open' ? 'badge-open' : 'badge-closed'}">${poll.status === 'open' ? 'Ανοιχτή' : 'Κλειστή'}</span>`;
  return councilLayout({
    title: 'Ψηφοφορία',
    user,
    active: 'psifismata',
    flash,
    content: `
    <h2 class="question-title">${e(poll.question)}</h2>
    <p class="event-meta">
      ${statusBadge}
      Δημιουργήθηκε: ${e(formatDateTime(poll.created_at))}
    </p>
    ${cancelled ? `<p class="flash flash-error">${icon('lock')} Η ψηφοφορία έχει ακυρωθεί και δεν δέχεται ψήφους.</p>` : ''}
    ${resultsHtml({ poll, results, justVoted: false, canRefresh: false })}
    <div class="card">
      <h2 class="section-title">Ενέργειες</h2>
      <div class="quick-actions">
        ${cancelled ? '' : (poll.status === 'open'
          ? `<form method="post" action="/symvoulio/psifismata/${Number(poll.id)}/kleisimo" class="inline-form"
                   onsubmit="return confirm('Να κλείσει η ψηφοφορία; Οι χρήστες δεν θα μπορούν πια να ψηφίσουν.');">
               <button type="submit" class="btn btn-secondary">${icon('lock')} Κλείσιμο ψηφοφορίας</button>
             </form>`
          : `<form method="post" action="/symvoulio/psifismata/${Number(poll.id)}/anoigma" class="inline-form">
               <button type="submit" class="btn btn-primary">${icon('check')} Άνοιγμα ψηφοφορίας</button>
             </form>`)}
        ${user.is_owner && !cancelled ? `
        <form method="post" action="/symvoulio/psifismata/${Number(poll.id)}/akyrosi" class="inline-form"
              onsubmit="return confirm('Θέλετε σίγουρα να ακυρώσετε αυτή την ψηφοφορία;');">
          <button type="submit" class="btn btn-danger">${icon('trash')} Ακύρωση ψηφοφορίας</button>
        </form>` : ''}
        <form method="post" action="/symvoulio/psifismata/${Number(poll.id)}/diagrafi" class="inline-form"
              onsubmit="return confirm('Να διαγραφεί οριστικά αυτή η ψηφοφορία μαζί με τις ψήφους της;');">
          <button type="submit" class="btn btn-danger">${icon('trash')} Διαγραφή</button>
        </form>
      </div>
      <p class="field-hint">Η ψηφοφορία είναι διαθέσιμη στους συνδεδεμένους χρήστες στη διεύθυνση <code>/psifos/${Number(poll.id)}</code>.</p>
    </div>`
  });
}

function accessPage({ user, usersCount, managers, search, found, errors = [], flash }) {
  const errorsHtml = errors.length
    ? `<div class="flash flash-error"><ul class="error-list">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  const managerList = managers.length
    ? managers.map(m => `
      <article class="card manager-card">
        <div class="manager-identity">
          <strong>Λογαριασμός #${Number(m.id)}</strong>
          <span class="badge badge-admin">Διαχειριστής</span>
        </div>
        <form method="post" action="/symvoulio/prosvasi/afairesi" class="inline-form"
              onsubmit="return confirm('Να αφαιρεθεί η άδεια διαχείρισης από αυτόν τον λογαριασμό;');">
          <input type="hidden" name="user_id" value="${Number(m.id)}">
          <button type="submit" class="btn btn-danger">Αφαίρεση δικαιωμάτων διαχείρισης</button>
        </form>
      </article>`).join('')
    : `<div class="card empty-card"><p>Δεν υπάρχουν διαχειριστές ακόμα.</p></div>`;

  let searchResult = '';
  if (search) {
    if (!found) {
      searchResult = `<div class="flash flash-error">Δεν βρέθηκε λογαριασμός.</div>`;
    } else if (found.role === 'owner') {
      searchResult = `
      <div class="card search-result-card">
        <p>Βρέθηκε ο λογαριασμός ιδιοκτήτη.</p>
        <p class="form-note">${icon('shield')} Αυτός ο λογαριασμός δεν αλλάζει από αυτή τη σελίδα.</p>
      </div>`;
    } else if (found.role === 'manager') {
      searchResult = `
      <div class="card search-result-card">
        <p>Βρέθηκε λογαριασμός διαχειριστή: <strong>Λογαριασμός #${Number(found.id)}</strong> <span class="badge badge-admin">Διαχειριστής</span></p>
        <form method="post" action="/symvoulio/prosvasi/afairesi" class="inline-form"
              onsubmit="return confirm('Να αφαιρεθεί η άδεια διαχείρισης από αυτόν τον λογαριασμό;');">
          <input type="hidden" name="user_id" value="${Number(found.id)}">
          <button type="submit" class="btn btn-danger">Αφαίρεση δικαιωμάτων διαχείρισης</button>
        </form>
      </div>`;
    } else {
      searchResult = `
      <div class="card search-result-card">
        <p>Βρέθηκε λογαριασμός απλού χρήστη: <strong>Λογαριασμός #${Number(found.id)}</strong> <span class="badge badge-user">Απλός χρήστης</span></p>
        <form method="post" action="/symvoulio/prosvasi/parachorisi" class="inline-form">
          <input type="hidden" name="user_id" value="${Number(found.id)}">
          <button type="submit" class="btn btn-primary">Παραχώρηση δικαιωμάτων διαχείρισης</button>
        </form>
      </div>`;
    }
  }

  return councilLayout({
    title: 'Διαχείριση πρόσβασης',
    user,
    active: 'prosvasi',
    flash,
    content: `
    ${errorsHtml}
    <div class="stat-grid">
      <div class="card stat-card">
        <span class="stat-number">${usersCount}</span>
        <span class="stat-label">${icon('users')} Σύνολο χρηστών</span>
      </div>
      <div class="card stat-card">
        <span class="stat-number">${managers.length}</span>
        <span class="stat-label">${icon('shield')} Διαχειριστές</span>
      </div>
    </div>
    <p class="lead">Μόνο ο ιδιοκτήτης μπορεί να παραχωρεί ή να αφαιρεί δικαιώματα διαχείρισης. Ο λογαριασμός ιδιοκτήτη δεν αλλάζει.</p>
    <form method="post" action="/symvoulio/prosvasi" class="card form-card">
      <h2 class="section-title">Αναζήτηση λογαριασμού</h2>
      <div class="inline-create">
        <div class="field">
          <label for="username">Όνομα χρήστη</label>
          <input id="username" name="username" type="text" maxlength="30" required>
          <p class="field-hint">Αναζήτηση με το ακριβές όνομα χρήστη.</p>
        </div>
        <button type="submit" class="btn btn-secondary">Αναζήτηση</button>
      </div>
    </form>
    ${searchResult}
    <div class="card access-owner-note">
      <p>${icon('shield')} Ο λογαριασμός ιδιοκτήτη προστατεύεται και δεν αλλάζει από αυτή τη σελίδα.</p>
    </div>
    <section class="managers-section">
      <h2 class="section-title">Διαχειριστές</h2>
      <p class="lead">Σύνολο διαχειριστών: <strong>${managers.length}</strong></p>
      ${managerList}
    </section>`
  });
}

function accountPage({ user, errors = [], flash }) {
  const errorsHtml = errors.length
    ? `<div class="flash flash-error"><ul class="error-list">${errors.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>`
    : '';
  const managementLink = user.is_owner
    ? `<a class="btn btn-secondary" href="/symvoulio">Περιοχή διαχείρισης</a>`
    : user.is_manager
      ? `<a class="btn btn-secondary" href="/symvoulio/ekdiloseis">Εργαλεία διαχείρισης</a>`
      : '';
  return layout({
    user,
    title: 'Ο λογαριασμός μου',
    content: `
    <h1 class="page-title">Ο λογαριασμός μου</h1>
    <p class="lead">Ο λογαριασμός σου · ${e(roleLabel(user))}</p>
    ${flashHtml(flash)}
    ${errorsHtml}
    ${managementLink ? `<div class="toolbar">${managementLink}</div>` : ''}
    <form method="post" action="/logariasmos/kodikos" class="card form-card">
      <h2 class="section-title">Αλλαγή κωδικού πρόσβασης</h2>
      <div class="field">
        <label for="current">Τρέχων κωδικός πρόσβασης</label>
        <input id="current" name="current" type="password" autocomplete="current-password" required>
      </div>
      <div class="field">
        <label for="next">Νέος κωδικός πρόσβασης</label>
        <input id="next" name="next" type="password" autocomplete="new-password" minlength="8" required>
      </div>
      <div class="field">
        <label for="confirm">Επανάληψη νέου κωδικού πρόσβασης</label>
        <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required>
      </div>
      <button type="submit" class="btn btn-primary">${icon('key')} Αλλαγή κωδικού</button>
    </form>`
  });
}

module.exports = {
  layout,
  councilLayout,
  home,
  suggestPage,
  suggestSuccess,
  suggestionBoardPage,
  eventsPage,
  voteListPage,
  pollVotePage,
  pollResultsPage,
  resultsHtml,
  errorPage,
  forbiddenPage,
  notFoundPage,
  entryPage,
  dashboardPage,
  eventsAdminPage,
  eventDetailPage,
  eventFormPage,
  pollsAdminPage,
  pollFormPage,
  pollAdminPage,
  accessPage,
  accountPage,
  flashHtml,
  icon
};
