(() => {
  const cfg = window.STONE_CONFIG || {};
  const hasSupabaseConfig = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const supabaseClient = hasSupabaseConfig
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;
  const DEMO_KEY = "stone-awards-demo-v2";

  const state = {
    demo: !supabaseClient,
    user: null,
    token: null,
    isAdmin: false,
    page: "home",
    data: null,
    adminData: null,
    lastCreatedCode: null,
    selectedCategoryId: null
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function demoStore() {
    let db;
    try { db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (_) {}
    if (db) return db;

    const nomineeNames = [
      "coreqwc", "Whisper", "Devatiy", "unitazik", "Terr", "2012", "fogi",
      "weeklyy", "4etr1", "sa_MI", "фанк", "СаняТЦК", "dm"
    ];
    const participants = nomineeNames.map((display_name, i) => ({
      id: `p${i+1}`, display_name,
      code: `STONE-${String(i+1).padStart(3,"0")}`, active: true
    }));
    const allNominees = participants.map(p => p.id);
    const categories = [
      ["Завоз года", "За самое громкое и запоминающееся появление."],
      ["STONE KING", "Настоящий король каменного сообщества."],
      ["Легенда года", "Человек, которого невозможно забыть."],
      ["Мем года", "За самый смешной и запоминающийся мем."],
      ["Открытие года", "Для тех, кто неожиданно заявил о себе."],
      ["Кринж года", "За самые неловкие и запоминающиеся моменты."],
      ["Персона года", "За особый вклад в жизнь сообщества."],
      ["Токсик года", "Обладатель самого узнаваемого характера."],
      ["Событие года", "За самый обсуждаемый момент."],
      ["Ебень года", "Особое звание для самого выдающегося персонажа."],
      ["Мультигеймер года", "Для человека, который успел покорить множество игр."],
      ["Ксер года", "За особые достижения в своей номинации."],
      ["Дуо года", "Для самой узнаваемой и слаженной пары."],
      ["Дотер года", "Главный представитель мира Dota 2."],
      ["Растер года", "Для настоящего представителя Rust."],
      ["Аура года", "За максимальную харизму и присутствие."],
      ["Харизма года", "Для человека с самой узнаваемой личностью."],
      ["Актив года", "Для самого активного участника сообщества."],
      ["Пидорас года", "Номинация уже нашла своего обладателя — её досрочно забрал КАБАН! 🏆"],
      ["IQ года", "За выдающийся интеллект, логику и нестандартное мышление."]
    ];
    db = {
      participants,
      categories: categories.map(([title, description], i) => ({
        id: `c${i+1}`, title, description, is_open: false, is_secret: false,
        is_released: true, fixed_winner: title === "Пидорас года" ? "КАБАН!" : null,
        nominees: title === "Пидорас года" ? [] : allNominees.slice()
      })),
      votes: {},
      resultsVisible: false
    };
    localStorage.setItem(DEMO_KEY, JSON.stringify(db));
    return db;
  }

  function saveDemo(db) { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); }

  function demoCategoryView(db, category, participantId, admin=false) {
    const nominees = (category.nominees || []).map(pid => {
      const p = db.participants.find(x => x.id === pid);
      const count = Object.values(db.votes).filter(v => v[category.id] === pid).length;
      return p ? {id:pid, participant_id:pid, display_name:p.display_name, votes:(admin || db.resultsVisible) ? count : null} : null;
    }).filter(Boolean);
    return {
      ...category,
      my_vote: participantId ? (db.votes[participantId] || {})[category.id] || null : null,
      nominees
    };
  }

  function getDemoSiteData() {
    const db = demoStore();
    return {
      profile: state.user,
      results_visible: db.resultsVisible,
      categories: db.categories.filter(c => !c.is_secret || c.is_released || c.is_open).map(c => demoCategoryView(db,c,state.user.id))
    };
  }

  function getDemoAdminData() {
    const db = demoStore();
    return {
      participants: db.participants,
      results_visible: db.resultsVisible,
      categories: db.categories.map(c => demoCategoryView(db,c,null,true))
    };
  }

  async function loadSiteData() {
    if (state.demo) {
      state.data = getDemoSiteData();
      return;
    }
    const {data, error} = await supabaseClient.rpc("get_site_data", {p_token: state.token});
    if (error) throw error;
    state.data = data;
  }

  async function loadAdminData() {
    if (state.demo) {
      state.adminData = getDemoAdminData();
      return;
    }
    const {data, error} = await supabaseClient.rpc("admin_dashboard");
    if (error) throw error;
    state.adminData = data;
  }

  function showSite() {
    $("auth-screen").classList.add("hidden");
    $("site").classList.remove("hidden");
    $("user-chip").textContent = state.isAdmin ? "ОРГАНИЗАТОР" : state.user.display_name;
    document.querySelector(".admin-nav").classList.toggle("hidden", !state.isAdmin);
    render();
  }

  function showAuth() {
    $("site").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
    $("access-code").value = "";
    $("admin-password").value = "";
  }

  async function loginWithCode(code) {
    if (state.demo) {
      const normalized = code.trim().toUpperCase();
      if (normalized === "STONE-ADMIN") {
        state.user = {id:"admin", display_name:"Организатор"};
        state.isAdmin = true;
        state.token = "demo-admin";
        await loadAdminData();
      } else {
        const db = demoStore();
        const participant = db.participants.find(p => p.active && p.code === normalized);
        if (!participant) throw new Error("Код не найден. Проверьте его и попробуйте ещё раз.");
        state.user = {id:participant.id, display_name:participant.display_name};
        state.token = normalized;
        state.isAdmin = false;
        await loadSiteData();
      }
    } else {
      const {data, error} = await supabaseClient.rpc("redeem_access_code", {p_code: code.trim()});
      if (error) throw error;
      state.token = data.token;
      sessionStorage.setItem("stone-awards-access-token", data.token);
      state.user = data.participant;
      state.isAdmin = false;
      await loadSiteData();
    }
    state.page = "home";
    showSite();
  }

  async function adminLogin(email, password) {
    if (state.demo) {
      throw new Error("В демо-режиме используйте код STONE-ADMIN. Для настоящего входа подключите Supabase.");
    }
    const {error} = await supabaseClient.auth.signInWithPassword({email, password});
    if (error) throw error;
    state.isAdmin = true;
    sessionStorage.removeItem("stone-awards-access-token");
    state.user = {id:"admin", display_name:"Организатор"};
    state.token = null;
    await loadAdminData();
    state.page = "admin";
    showSite();
  }

  async function logout() {
    if (!state.demo && state.isAdmin) await supabaseClient.auth.signOut();
    state.user = null; state.token = null; state.isAdmin = false;
    sessionStorage.removeItem("stone-awards-access-token");
    state.data = null; state.adminData = null; state.page = "home";
    showAuth();
  }

  function pageTitle(kicker, title, subtitle) {
    return `<div class="page-title"><div class="kicker">${kicker}</div><h2>${title}</h2><p>${subtitle}</p></div>`;
  }

  function categoryCard(c, index) {
    const already = Boolean(c.my_vote);
    const status = already
      ? `<span class="status-pill voted">ГОЛОС ПРИНЯТ</span>`
      : `<span class="status-pill open">ГОЛОСОВАНИЕ ОТКРЫТО</span>`;
    const secret = c.is_secret ? `<span class="category-tag">✦ СЕКРЕТНАЯ</span>` : "";
    return `<article class="category-card category-card-button" role="button" tabindex="0" data-open-category="${esc(c.id)}">
      <div class="category-top"><span class="category-index">NOMINATION / ${String(index+1).padStart(2,"0")}</span><span class="category-card-status">${status}</span></div>
      <div class="category-card-tags">${secret}</div>
      <h4>${esc(c.title)}</h4>
      <p>${esc(c.description || "Номинация премии STONE AWARDS.")}</p>
      <div class="card-footer"><span>${(c.nominees || []).length} номинантов · ${already ? "ты уже проголосовал" : "выбери своего фаворита"}</span><span class="card-cta">${already ? "МОЙ ГОЛОС ✓" : "ГОЛОСОВАТЬ ↗"}</span></div>
    </article>`;
  }

  function closedCategoryCard(c, index) {
    const secret = c.is_secret ? `<span class="category-tag">✦ СЕКРЕТНАЯ</span>` : "";
    const fixed = c.fixed_winner ? `<div class="fixed-winner">🏆 УЖЕ ПРИСУЖДЕНА: <strong>${esc(c.fixed_winner)}</strong></div>` : "";
    const status = c.fixed_winner ? `<span class="status-pill voted">ПОБЕДИТЕЛЬ ИЗВЕСТЕН</span>` : `<span class="status-pill closed">ПОКА ЗАКРЫТО</span>`;
    const footer = c.fixed_winner
      ? `<span>Специальная награда</span><span class="card-cta closed-cta">🏆 ${esc(c.fixed_winner)}</span>`
      : `<span>${(c.nominees || []).length} номинантов</span><span class="card-cta closed-cta">ОЖИДАЕТ ОТКРЫТИЯ</span>`;
    return `<article class="category-card category-card-closed ${c.fixed_winner ? "category-card-awarded" : ""}">
      <div class="category-top"><span class="category-index">NOMINATION / ${String(index+1).padStart(2,"0")}</span>${status}</div>
      <div class="category-card-tags">${secret}</div>
      <h4>${esc(c.title)}</h4>
      <p>${esc(c.description || "Номинация премии STONE AWARDS.")}</p>
      ${fixed}
      <div class="card-footer">${footer}</div>
    </article>`;
  }

  function renderHome() {
    const allCategories = state.isAdmin
      ? (state.adminData?.categories || [])
      : (state.data?.categories || []);
    const categories = allCategories.filter(c => !c.is_secret || c.is_released || c.is_open);
    const openCategories = categories.filter(c => c.is_open);
    const openCount = openCategories.length;
    const votedCount = categories.filter(c => c.my_vote).length;
    return `<section class="hero">
      <div class="hero-copy">
        <div class="kicker">THE COMMUNITY AWARDS · 2026</div>
        <h2>Сила сообщества.<span>Признание достойных.</span></h2>
        <p>Добро пожаловать на STONE AWARDS — премию нашего сообщества. Пролистай страницу вниз, выбери открытую номинацию и поддержи того, кто, по твоему мнению, достоин победы.</p>
        <div class="hero-actions"><button class="btn btn-primary" data-page="vote">СМОТРЕТЬ ОТКРЫТЫЕ НОМИНАЦИИ ↘</button><button class="btn btn-glass" data-page="results">РЕЗУЛЬТАТЫ</button></div>
      </div>
      <div class="hero-art"><div class="trophy-orbit"><div class="trophy">S</div><div class="orbit-label">STONE · 2026</div></div></div>
    </section>
    <section class="stats-grid">
      <div class="stat-card"><div class="stat-number">${categories.length}</div><div class="stat-label">ВСЕГО НОМИНАЦИЙ</div></div>
      <div class="stat-card"><div class="stat-number">${openCount}</div><div class="stat-label">ОТКРЫТО ДЛЯ ГОЛОСОВАНИЯ</div></div>
      <div class="stat-card"><div class="stat-number">${votedCount}/${categories.length}</div><div class="stat-label">ТВОИ ГОЛОСА</div></div>
    </section>
    <section class="open-nominations" id="open-nominations">
      <div class="section-heading"><div><div class="kicker">CHOOSE YOUR NOMINEE</div><h3>Открытые номинации</h3><p>Нажми на карточку, чтобы перейти к выбору номинанта.</p></div><span class="open-counter">${openCount} ${openCount === 1 ? "НОМИНАЦИЯ" : ([2,3,4].includes(openCount % 10) && ![12,13,14].includes(openCount % 100) ? "НОМИНАЦИИ" : "НОМИНАЦИЙ")}</span></div>
      <div class="category-grid">${openCategories.length ? openCategories.map(categoryCard).join("") : `<div class="empty-state open-empty"><span class="empty-orb">◇</span><strong>Пока нет открытых номинаций</strong><span>Когда организатор откроет голосование, карточки появятся здесь автоматически.</span></div>`}</div>
    </section>
    ${categories.some(c => !c.is_open) ? `<section class="other-nominations"><div class="section-heading"><div><div class="kicker">COMING UP</div><h3>Другие номинации</h3><p>Эти категории уже объявлены, но голосование по ним пока закрыто.</p></div></div><div class="category-grid">${categories.filter(c => !c.is_open).map(closedCategoryCard).join("")}</div></section>` : ""}`;
  }

  function renderVote() {
    const allCategories = state.isAdmin
      ? (state.adminData?.categories || [])
      : (state.data?.categories || []);
    const categories = allCategories.filter(c => c.is_open && (!c.is_secret || c.is_released || c.is_open));

    if (state.selectedCategoryId) {
      const c = categories.find(item => item.id === state.selectedCategoryId);
      if (!c) {
        return `${pageTitle("YOUR VOICE MATTERS","Номинация недоступна","Похоже, организатор закрыл это голосование или оно больше не опубликовано.")}<div class="empty-state"><strong>Голосование сейчас недоступно.</strong><p>Вернись к списку открытых номинаций и выбери другую категорию.</p><button class="btn btn-glass" data-page="home">← НА ГЛАВНУЮ</button></div>`;
      }
      const already = Boolean(c.my_vote);
      const nominees = (c.nominees || []).map(n => {
        const selected = c.my_vote === n.id;
        return `<label class="nominee-option ${selected ? "selected" : ""}">
          <input type="radio" name="vote-${c.id}" value="${n.id}" ${selected ? "checked" : ""} ${already || !c.is_open || state.isAdmin ? "disabled" : ""}>
          <span>${esc(n.display_name)}</span>
        </label>`;
      }).join("");
      let action = "";
      if (state.isAdmin) action = `<span class="voted-note">ПРЕДПРОСМОТР ОРГАНИЗАТОРА</span>`;
      else if (already) action = `<span class="voted-note">✓ ТВОЙ ГОЛОС ПРИНЯТ</span>`;
      else if (!c.is_open) action = `<span class="voted-note">ГОЛОСОВАНИЕ ЗАКРЫТО</span>`;
      else if (!(c.nominees || []).length) action = `<span class="voted-note">ПОКА НЕТ НОМИНАНТОВ</span>`;
      else action = `<button class="btn btn-primary btn-small" data-action="vote" data-category="${esc(c.id)}">ПОДТВЕРДИТЬ ГОЛОС ↗</button>`;
      return `${pageTitle("CAST YOUR VOTE",esc(c.title),"Выбери одного номинанта. После подтверждения изменить голос будет нельзя.")}<div class="vote-back-row"><button class="text-button" data-page="vote">← К ОТКРЫТЫМ НОМИНАЦИЯМ</button><span class="status-pill open">ГОЛОСОВАНИЕ ОТКРЫТО</span></div>
        ${state.demo ? `<div class="notice">ДЕМО-РЕЖИМ: голоса сохраняются только в этом браузере. Для общего голосования подключите Supabase.</div>`:""}
        <article class="vote-card">
          <div class="vote-card-head"><div><div class="category-index">NOMINATION / ${String(allCategories.findIndex(item=>item.id===c.id)+1).padStart(2,"0")}</div><h3>${esc(c.title)}</h3><p class="description">${esc(c.description || "Выбери участника, который достоин этой награды.")}</p></div></div>
          ${nominees ? `<div class="nominee-list">${nominees}</div>` : `<div class="empty-state" style="margin-top:18px">Организатор ещё не добавил номинантов.</div>`}
          <div class="vote-actions">${action}<span class="candidate-count">${(c.nominees||[]).length} КАНДИДАТОВ</span></div>
        </article>`;
    }

    return `${pageTitle("YOUR VOICE MATTERS","Открытые номинации","Выбери номинацию, чтобы перейти к списку кандидатов и отдать свой голос.")}
      ${state.demo ? `<div class="notice">ДЕМО-РЕЖИМ: голоса сохраняются только в этом браузере. Для общего голосования подключите Supabase.</div>`:""}
      <div class="category-grid">${categories.length ? categories.map(categoryCard).join("") : `<div class="empty-state open-empty"><span class="empty-orb">◇</span><strong>Сейчас голосование не открыто</strong><span>Новые номинации появятся здесь, как только организатор откроет приём голосов.</span><button class="btn btn-glass" data-page="home">← НА ГЛАВНУЮ</button></div>`}</div>`;
  }

  function renderResults() {
    const visible = Boolean(state.data?.results_visible);
    if (!visible && !state.isAdmin) {
      return `${pageTitle("THE MOMENT OF TRUTH","Результаты","Имена победителей будут объявлены в нужный момент.")}<div class="results-hidden"><div class="lock-icon">✦</div><h3>Интрига сохраняется</h3><p>Организатор пока не открыл результаты. Возвращайся позже — возможно, именно твоего фаворита ждёт победа.</p></div>`;
    }
    const categories = state.isAdmin ? (state.adminData?.categories || []) : (state.data?.categories || []);
    const html = categories.map((c,i) => {
      const sorted = [...(c.nominees || [])].sort((a,b)=>(b.votes||0)-(a.votes||0));
      const max = Math.max(1, ...sorted.map(n=>n.votes||0));
      const award = c.fixed_winner
        ? `<div class="result-fixed-winner">🏆 Победитель: <strong>${esc(c.fixed_winner)}</strong></div>`
        : (sorted.length ? sorted.map((n,idx)=>`<div class="result-row"><div class="result-rank">${idx+1}</div><div><div class="result-name">${esc(n.display_name)}</div><div class="result-bar"><span style="width:${Math.round(((n.votes||0)/max)*100)}%"></span></div></div><div class="result-count">${n.votes||0}</div></div>`).join("") : `<p class="description">Нет номинантов.</p>`);
      return `<article class="vote-card"><div class="category-index">AWARD / ${String(i+1).padStart(2,"0")}</div><h3>${esc(c.title)}</h3>${award}</article>`;
    }).join("");
    return `${pageTitle("AND THE WINNER IS...","Результаты","Текущая статистика голосования по каждой номинации.")}${state.demo ? `<div class="notice">ДЕМО-РЕЖИМ: статистика не синхронизируется между разными устройствами.</div>`:""}${html || `<div class="empty-state">Пока нет результатов.</div>`}`;
  }

  function renderAdmin() {
    const d = state.adminData || {participants:[],categories:[],results_visible:false};
    const participants = d.participants || [];
    const categories = d.categories || [];
    const participantOptions = participants.map(p=>`<option value="${p.id}">${esc(p.display_name)}</option>`).join("");
    const categoryOptions = categories.filter(c=>!c.fixed_winner).map(c=>`<option value="${c.id}">${esc(c.title)}</option>`).join("");
    const categoryItems = categories.map(c=>`<div class="admin-item">
      <div class="admin-item-head"><strong>${esc(c.title)}</strong><small>${c.fixed_winner ? "УЖЕ ПРИСУЖДЕНА" : (c.is_secret ? "СЕКРЕТНАЯ" : "ОБЫЧНАЯ")} · ${(c.nominees||[]).length} кандидатов</small></div>
      <div class="admin-item-status"><span class="status-pill ${c.fixed_winner ? "voted" : (c.is_open ? "open":"closed")}">${c.fixed_winner ? "ПОБЕДИТЕЛЬ ИЗВЕСТЕН" : (c.is_open ? "ГОЛОСОВАНИЕ ОТКРЫТО" : "ГОЛОСОВАНИЕ ЗАКРЫТО")}</span>${c.fixed_winner ? `<span class="status-pill voted">🏆 ${esc(c.fixed_winner)}</span>` : (c.is_secret ? `<span class="status-pill ${c.is_released ? "voted":"closed"}">${c.is_released ? "ПОКАЗЫВАЕТСЯ УЧАСТНИКАМ" : "СКРЫТА ОТ УЧАСТНИКОВ"}</span>` : "")}</div>
      ${c.fixed_winner ? `<small class="admin-nominee-summary">Эта награда уже присуждена и не участвует в голосовании.</small>` : `<div class="admin-item-actions">
        <button class="btn ${c.is_open ? "btn-danger":"btn-primary"} btn-small" data-action="toggle-open" data-id="${c.id}" data-value="${!c.is_open}">${c.is_open ? "ЗАКРЫТЬ ГОЛОСОВАНИЕ" : (c.is_secret && !c.is_released ? "ОТКРЫТЬ И ПОКАЗАТЬ" : "ОТКРЫТЬ ГОЛОСОВАНИЕ")}</button>
        ${c.is_secret && !c.is_open ? `<button class="btn btn-glass btn-small" data-action="toggle-release" data-id="${c.id}" data-value="${!c.is_released}">${c.is_released ? "СКРЫТЬ НОМИНАЦИЮ" : "ПОКАЗАТЬ БЕЗ ГОЛОСОВАНИЯ"}</button>` : ""}
      </div>`}
      <small class="admin-nominee-summary">${(c.nominees||[]).map(n=>esc(n.display_name)).join(" · ") || (c.fixed_winner ? "КАБАН 🏆" : "Номинанты не добавлены")}</small>
    </div>`).join("");
    const peopleItems = participants.map(p=>`<div class="admin-item">
      <div class="admin-item-head"><strong>${esc(p.display_name)}</strong><small>${p.active === false ? "ОТКЛЮЧЁН":"АКТИВЕН"}</small></div>
      <div class="admin-item-actions"><button class="btn btn-outline btn-small" data-action="reset-participant-code" data-id="${esc(p.id)}" data-name="${esc(p.display_name)}">СМЕНИТЬ КОД ДОСТУПА</button></div>
    </div>`).join("");
    return `${pageTitle("CONTROL ROOM","Панель организатора","Управляй номинациями, участниками, голосованием и моментом объявления победителей.")}
      ${state.demo ? `<div class="notice">ДЕМО-РЕЖИМ: все изменения сохраняются в localStorage этого браузера. Для настоящего сайта настройте Supabase по инструкции в README.</div>`:""}
      <div class="admin-panel" style="margin-bottom:16px">
        <h3>Публикация результатов</h3><p>Пока переключатель выключен, участники не видят количество голосов и победителей.</p>
        <div class="toggle-row"><span>Открыть результаты всем участникам</span><input id="results-toggle" type="checkbox" ${d.results_visible ? "checked":""}></div>
      </div>
      <div class="admin-layout">
        <section class="admin-panel"><h3>Новый участник</h3><p>Создай участника и выдай ему персональный код входа. Код показывается только один раз — передай его человеку.</p>
          <form id="create-participant-form" class="admin-form"><div><label>ИМЯ УЧАСТНИКА</label><input name="display_name" placeholder="Например, Алексей" required maxlength="60"></div><button class="btn btn-gold" type="submit">СОЗДАТЬ КОД ДОСТУПА ↗</button></form>
          <div id="new-code-output"></div>
          <div id="participant-code-output"></div>
          <div style="margin-top:20px"><div class="section-heading"><div><h3 style="font-size:16px">Участники (${participants.length})</h3></div></div><div class="admin-list">${peopleItems || `<div class="empty-state">Участников пока нет.</div>`}</div></div>
        </section>
        <section class="admin-panel"><h3>Новая номинация</h3><p>Создай категорию. Секретную номинацию можно будет открыть отдельно.</p>
          <form id="create-category-form" class="admin-form">
            <div><label>НАЗВАНИЕ</label><input name="title" placeholder="Например, Человек года" required maxlength="80"></div>
            <div><label>ОПИСАНИЕ</label><textarea name="description" rows="2" placeholder="Коротко о номинации"></textarea></div>
            <label class="toggle-row" style="margin:0"><span>Секретная номинация</span><input name="is_secret" type="checkbox"></label>
            <button class="btn btn-gold" type="submit">СОЗДАТЬ НОМИНАЦИЮ ↗</button>
          </form>
          <div style="border-top:1px solid var(--line);margin-top:22px;padding-top:19px"><h3 style="font-size:16px">Добавить номинанта</h3>
            <form id="add-nominee-form" class="admin-form">
              <div><label>НОМИНАЦИЯ</label><select name="category_id" required>${categoryOptions}</select></div>
              <div><label>УЧАСТНИК</label><select name="participant_id" required>${participantOptions}</select></div>
              <button class="btn btn-outline" type="submit">ДОБАВИТЬ КАНДИДАТА</button>
            </form>
          </div>
        </section>
      </div>
      <section class="admin-panel" style="margin-top:16px"><h3>Управление номинациями</h3><p>Открывай и закрывай приём голосов. При открытии секретная номинация автоматически становится видна участникам.</p><div class="admin-list">${categoryItems || `<div class="empty-state">Создай первую номинацию.</div>`}</div></section>`;
  }

  function render() {
    document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.page === state.page));
    const content = $("page-content");
    if (state.page === "home") content.innerHTML = renderHome();
    else if (state.page === "vote") content.innerHTML = renderVote();
    else if (state.page === "results") content.innerHTML = renderResults();
    else if (state.page === "admin" && state.isAdmin) content.innerHTML = renderAdmin();
    else { state.page = "home"; content.innerHTML = renderHome(); }
  }

  async function refresh() {
    if (!state.isAdmin && state.token) await loadSiteData();
    if (state.isAdmin) await loadAdminData();
    render();
  }

  async function castVote(categoryId) {
    const input = document.querySelector(`input[name="vote-${CSS.escape(categoryId)}"]:checked`);
    if (!input) return toast("Сначала выбери номинанта.");
    if (!confirm("Подтвердить голос? После отправки изменить его будет нельзя.")) return;
    if (state.demo) {
      const db = demoStore();
      db.votes[state.user.id] = db.votes[state.user.id] || {};
      if (db.votes[state.user.id][categoryId]) return toast("Ты уже голосовал в этой номинации.");
      db.votes[state.user.id][categoryId] = input.value;
      saveDemo(db);
    } else {
      const {error} = await supabaseClient.rpc("cast_vote", {p_token:state.token, p_category_id:categoryId, p_nominee_id:input.value});
      if (error) throw error;
    }
    await refresh();
    toast("Голос принят. Спасибо за участие!");
  }

  async function createParticipant(form) {
    const name = new FormData(form).get("display_name").trim();
    if (!name) return;
    let code;
    if (state.demo) {
      const db = demoStore();
      const id = `p${Date.now()}`;
      code = "STONE-" + Math.random().toString(36).slice(2,10).toUpperCase();
      db.participants.push({id,display_name:name,code,active:true});
      saveDemo(db);
    } else {
      const {data,error} = await supabaseClient.rpc("admin_create_participant",{p_display_name:name});
      if (error) throw error;
      code = data.code;
    }
    state.lastCreatedCode = code;
    $("new-code-output").innerHTML = `<div class="code-reveal">КОД ДОСТУПА СОЗДАН — СОХРАНИ ЕГО И ПЕРЕДАЙ УЧАСТНИКУ.<code>${esc(code)}</code><button class="btn btn-outline btn-small" data-action="copy-code" data-code="${esc(code)}">СКОПИРОВАТЬ КОД</button></div>`;
    await loadAdminData(); render();
    $("new-code-output").innerHTML = `<div class="code-reveal">КОД ДОСТУПА СОЗДАН — СОХРАНИ ЕГО И ПЕРЕДАЙ УЧАСТНИКУ.<code>${esc(code)}</code><button class="btn btn-outline btn-small" data-action="copy-code" data-code="${esc(code)}">СКОПИРОВАТЬ КОД</button></div>`;
    form.reset();
  }

  async function resetParticipantCode(participantId, displayName) {
    if (!confirm(`Сменить код для ${displayName}? Старый код перестанет работать. Все голоса и номинации участника сохранятся.`)) return;
    let code;
    if (state.demo) {
      const db = demoStore();
      const participant = db.participants.find(p => p.id === participantId);
      if (!participant) throw new Error("Участник не найден.");
      code = "STONE-" + Math.random().toString(36).slice(2,10).toUpperCase();
      participant.code = code;
      saveDemo(db);
    } else {
      const {data,error} = await supabaseClient.rpc("admin_reset_participant_code", {p_participant_id:participantId});
      if (error) throw error;
      code = data.code;
    }
    await loadAdminData();
    render();
    $("participant-code-output").innerHTML = `<div class="code-reveal">НОВЫЙ КОД ДЛЯ ${esc(displayName.toUpperCase())}. СТАРЫЙ КОД БОЛЬШЕ НЕ РАБОТАЕТ. ГОЛОСА СОХРАНЕНЫ.<code>${esc(code)}</code><button class="btn btn-outline btn-small" data-action="copy-code" data-code="${esc(code)}">СКОПИРОВАТЬ КОД</button></div>`;
    toast("Код обновлён. Передай участнику новый код.");
  }

  async function createCategory(form) {
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    const description = String(fd.get("description") || "").trim();
    const secret = fd.get("is_secret") === "on";
    if (state.demo) {
      const db = demoStore();
      db.categories.push({id:`c${Date.now()}`,title,description,is_open:false,is_secret:secret,is_released:false,nominees:[]});
      saveDemo(db);
    } else {
      const {error} = await supabaseClient.rpc("admin_create_category",{p_title:title,p_description:description,p_is_secret:secret});
      if (error) throw error;
    }
    await loadAdminData(); render(); toast("Номинация создана.");
  }

  async function addNominee(form) {
    const fd = new FormData(form);
    const categoryId = fd.get("category_id");
    const participantId = fd.get("participant_id");
    if (state.demo) {
      const db = demoStore();
      const category = db.categories.find(c=>c.id===categoryId);
      if (!category) throw new Error("Номинация не найдена.");
      if (category.nominees.includes(participantId)) throw new Error("Этот участник уже добавлен.");
      category.nominees.push(participantId);
      saveDemo(db);
    } else {
      const {error} = await supabaseClient.rpc("admin_add_nominee",{p_category_id:categoryId,p_participant_id:participantId});
      if (error) throw error;
    }
    await loadAdminData(); render(); toast("Номинант добавлен.");
  }

  async function updateCategory(categoryId, field, value) {
    const current = state.adminData.categories.find(c=>c.id===categoryId);
    if (!current) throw new Error("Номинация не найдена.");
    if (current.fixed_winner) throw new Error("Эта награда уже присуждена и не открывается для голосования.");
    let isOpen = field === "is_open" ? value : current.is_open;
    let isReleased = field === "is_released" ? value : current.is_released;

    // Открытие секретной номинации одновременно публикует её для участников.
    if (field === "is_open" && value && current.is_secret) isReleased = true;

    if (state.demo) {
      const db = demoStore();
      const c = db.categories.find(x=>x.id===categoryId);
      if (c) {
        c.is_open = isOpen;
        c.is_released = isReleased;
      }
      saveDemo(db);
    } else {
      const {error} = await supabaseClient.rpc("admin_update_category",{
        p_category_id:categoryId,
        p_is_open:isOpen,
        p_is_released:isReleased
      });
      if (error) throw error;
    }
    await loadAdminData(); render();
    toast(isOpen ? "Голосование открыто. Номинация опубликована." : "Голосование закрыто.");
  }

  async function setResultsVisible(value) {
    if (state.demo) {
      const db = demoStore(); db.resultsVisible = value; saveDemo(db);
    } else {
      const {error} = await supabaseClient.rpc("admin_set_results_visible",{p_visible:value});
      if (error) throw error;
    }
    await loadAdminData(); render();
    toast(value ? "Результаты опубликованы." : "Результаты скрыты.");
  }

  document.addEventListener("submit", async (event) => {
    try {
      if (event.target.id === "code-form") {
        event.preventDefault();
        await loginWithCode($("access-code").value);
      } else if (event.target.id === "admin-login-form") {
        event.preventDefault();
        await adminLogin($("admin-email").value,$("admin-password").value);
      } else if (event.target.id === "create-participant-form") {
        event.preventDefault(); await createParticipant(event.target);
      } else if (event.target.id === "create-category-form") {
        event.preventDefault(); await createCategory(event.target);
      } else if (event.target.id === "add-nominee-form") {
        event.preventDefault(); await addNominee(event.target);
      }
    } catch (error) { toast(error.message || "Произошла ошибка."); }
  });

  document.addEventListener("click", async (event) => {
    const categoryButton = event.target.closest("[data-open-category]");
    if (categoryButton) {
      event.preventDefault();
      try {
        if (!state.isAdmin && state.token) await loadSiteData();
        state.selectedCategoryId = categoryButton.dataset.openCategory;
        state.page = "vote";
        render();
        window.scrollTo({top:0, behavior:"smooth"});
      } catch (error) { toast(error.message || "Не удалось открыть номинацию."); }
      return;
    }

    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      const page = pageButton.dataset.page;
      if (page === "admin" && !state.isAdmin) return;
      if (page === "vote") state.selectedCategoryId = null;
      state.page = page;
      if (page === "admin" || (page === "results" && state.isAdmin)) await loadAdminData();
      else if (!state.isAdmin && state.token && ["home","vote","results"].includes(page)) await loadSiteData();
      render();
      $("main-nav").classList.remove("open");
      window.scrollTo({top:0, behavior:"smooth"});
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    try {
      const action = actionButton.dataset.action;
      if (action === "vote") await castVote(actionButton.dataset.category);
      if (action === "toggle-open") await updateCategory(actionButton.dataset.id,"is_open",actionButton.dataset.value === "true");
      if (action === "toggle-release") await updateCategory(actionButton.dataset.id,"is_released",actionButton.dataset.value === "true");
      if (action === "copy-code") {
        await navigator.clipboard.writeText(actionButton.dataset.code);
        toast("Код скопирован.");
      }
      if (action === "reset-participant-code") {
        await resetParticipantCode(actionButton.dataset.id, actionButton.dataset.name || "участника");
      }
    } catch (error) { toast(error.message || "Не удалось выполнить действие."); }
  });

  document.addEventListener("keydown", (event) => {
    const categoryCard = event.target.closest("[data-open-category]");
    if (categoryCard && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      categoryCard.click();
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.id === "results-toggle") {
      try { await setResultsVisible(event.target.checked); }
      catch (error) { toast(error.message || "Не удалось изменить настройку."); }
    }
    if (event.target.matches(".nominee-option input")) {
      document.querySelectorAll(`input[name="${CSS.escape(event.target.name)}"]`).forEach(input => {
        input.closest(".nominee-option").classList.toggle("selected", input.checked);
      });
    }
  });

  $("show-admin-login").addEventListener("click", () => {
    $("admin-login-form").classList.toggle("hidden");
  });
  $("logout-btn").addEventListener("click", logout);
  $("mobile-menu-btn").addEventListener("click", () => $("main-nav").classList.toggle("open"));

  // Пока участник находится на главной или в списке номинаций,
  // проверяем изменения организатора и обновляем карточки без перезагрузки.
  setInterval(async () => {
    if (state.user && !state.isAdmin && state.token &&
        (state.page === "home" || (state.page === "vote" && !state.selectedCategoryId))) {
      try {
        const previous = JSON.stringify(state.data);
        await loadSiteData();
        if (JSON.stringify(state.data) !== previous) render();
      } catch (error) {
        // Временный сбой сети не должен мешать голосованию.
      }
    }
  }, 15000);

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && state.user && !state.isAdmin && state.token) {
      try {
        await loadSiteData();
        if (state.page === "home" || (state.page === "vote" && !state.selectedCategoryId) || state.page === "results") {
          render();
        }
      } catch (error) {
        // Не прерываем работу интерфейса из-за временного сетевого сбоя.
      }
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === DEMO_KEY && state.demo && state.user && !state.isAdmin) {
      state.data = getDemoSiteData();
      render();
    }
  });

  if (!state.demo) {
    (async () => {
      try {
        const {data} = await supabaseClient.auth.getSession();
        if (data.session) {
          state.isAdmin = true;
          state.user = {id:"admin", display_name:"Организатор"};
          await loadAdminData();
          state.page = "admin";
          showSite();
          return;
        }
        const savedToken = sessionStorage.getItem("stone-awards-access-token");
        if (savedToken) {
          state.token = savedToken;
          await loadSiteData();
          state.user = state.data.profile;
          state.isAdmin = false;
          state.page = "home";
          showSite();
        }
      } catch (_) {
        sessionStorage.removeItem("stone-awards-access-token");
      }
    })();
  }

  if (state.demo) {
    const note = document.createElement("div");
    note.className = "demo-ribbon";
    note.textContent = "DEMO";
    note.style.cssText = "position:fixed;right:0;top:0;background:#b18a49;color:#16120b;font:700 8px sans-serif;letter-spacing:2px;padding:5px 9px;z-index:50;";
    document.body.appendChild(note);
  }
})();