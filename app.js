/* ============================================================
   하이브리드 가계부 — 오프라인 모바일 가계부
   모든 기록은 이 브라우저(localStorage)에만 저장됩니다.
   ============================================================ */
(function () {
  'use strict';

  var STORE_KEY = 'smart-ledger-v1';
  var APP_VERSION = '1.0.0';
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var KIND = {
    income: { label: '수입', chip: 'chip--income', dot: 'dot-income' },
    fixed: { label: '고정비', chip: 'chip--fixed', dot: 'dot-fixed' },
    loan: { label: '대출', chip: 'chip--loan', dot: 'dot-loan' },
    savings: { label: '저축·투자', chip: 'chip--savings', dot: 'dot-savings' }
  };
  var SUMKIND = {
    income: KIND.income,
    fixed: KIND.fixed,
    loan: KIND.loan,
    savings: KIND.savings,
    variable: { label: '변동 소비', chip: 'chip--variable', dot: 'dot-variable' }
  };
  var MEM = null;

  /* ---------- 유틸 ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function uid(p) { return (p || 'id') + Math.random().toString(36).slice(2, 9); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; }
  function money(n) { return (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('ko-KR') + '원'; }
  function wonPlain(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function pct(n) {
    if (!isFinite(n)) return '0%';
    var s = n.toFixed(1);
    if (s.slice(-2) === '.0') s = s.slice(0, -2);
    return s + '%';
  }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) {
    var p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function daysInMonth(y, m1) { return new Date(y, m1, 0).getDate(); }
  function sum(arr, f) { return arr.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  /* ---------- 저장소 ---------- */
  var storage = {
    read: function () {
      try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return MEM; }
    },
    write: function (v) {
      MEM = v;
      try { window.localStorage.setItem(STORE_KEY, v); } catch (e) { /* 사생활 보호 모드 등: 메모리에만 보관 */ }
    },
    clear: function () {
      MEM = null;
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
    }
  };

  /* ---------- 기본 구조 ---------- */
  function defaultCategories() {
    return [
      { id: 'cat_food', name: '식비', budget: 400000, subs: ['장보기', '외식', '배달', '카페'] },
      { id: 'cat_transport', name: '교통·차량', budget: 150000, subs: ['대중교통', '주유', '주차·택시'] },
      { id: 'cat_living', name: '생활·쇼핑', budget: 200000, subs: ['생활용품', '온라인쇼핑', '의류·뷰티'] },
      { id: 'cat_health', name: '건강·의료', budget: 50000, subs: ['병원', '약국'] },
      { id: 'cat_leisure', name: '여가·취미', budget: 100000, subs: ['문화', '취미'] },
      { id: 'cat_event', name: '비정기·경조사', budget: 100000, subs: ['경조사', '선물', '명절'] },
      { id: 'cat_etc', name: '기타', budget: 50000, subs: ['기타'] }
    ];
  }
  function defaultAccounts() {
    return [{ id: 'acc_main', name: '주거래 통장' }, { id: 'acc_life', name: '생활비 통장' }];
  }
  function defaultCards() {
    return [
      { id: 'card_a', name: '카드 A', billingDay: 25, accountId: 'acc_main' },
      { id: 'card_b', name: '카드 B', billingDay: 14, accountId: 'acc_life' }
    ];
  }

  function baseState() {
    return {
      version: 1,
      settings: { monthStartDay: 25 },
      accounts: defaultAccounts(),
      cards: defaultCards(),
      categories: defaultCategories(),
      items: [],
      txns: [],
      favorites: [],
      meta: { sample: false, welcome: false, createdAt: new Date().toISOString() }
    };
  }

  /* 정규화: 저장본/가져온 파일이 조금 어긋나도 살려서 읽습니다 */
  function normalize(raw) {
    var s = baseState();
    if (!raw || typeof raw !== 'object') return s;

    if (raw.settings && typeof raw.settings === 'object') {
      s.settings.monthStartDay = clamp(Math.round(num(raw.settings.monthStartDay) || 25), 1, 28);
    }
    if (Array.isArray(raw.accounts)) {
      s.accounts = raw.accounts.filter(function (a) { return a && typeof a === 'object'; }).map(function (a) {
        return { id: String(a.id || uid('acc_')), name: String(a.name || '통장').slice(0, 30) };
      });
    }
    if (Array.isArray(raw.cards)) {
      s.cards = raw.cards.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
        return {
          id: String(c.id || uid('card_')),
          name: String(c.name || '카드').slice(0, 30),
          billingDay: clamp(Math.round(num(c.billingDay) || 1), 1, 31),
          accountId: c.accountId ? String(c.accountId) : ''
        };
      });
    }
    if (Array.isArray(raw.categories)) {
      s.categories = raw.categories.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
        var subs = Array.isArray(c.subs) ? c.subs.filter(function (x) { return String(x).trim(); }).map(String) : [];
        return {
          id: String(c.id || uid('cat_')),
          name: String(c.name || '분류').slice(0, 20),
          budget: Math.max(0, Math.round(num(c.budget))),
          subs: subs.length ? subs : ['기타']
        };
      });
    }
    if (!s.categories.length) s.categories = defaultCategories();

    if (Array.isArray(raw.items)) {
      s.items = raw.items.filter(function (it) { return it && typeof it === 'object'; }).map(function (it) {
        var sch = it.schedule || {};
        var pay = it.pay || {};
        var kind = KIND[it.kind] ? it.kind : 'fixed';
        return {
          id: String(it.id || uid('it_')),
          name: String(it.name || '항목').slice(0, 40),
          kind: kind,
          amount: Math.max(0, Math.round(num(it.amount))),
          schedule: String(sch.type) === 'weekly'
            ? { type: 'weekly', weekday: clamp(Math.round(num(sch.weekday)), 0, 6) }
            : { type: 'monthly', day: clamp(Math.round(num(sch.day)) || 1, 1, 31) },
          pay: pay.type === 'card'
            ? { type: 'card', cardId: String(pay.cardId || '') }
            : pay.type === 'cash'
              ? { type: 'cash' }
              : { type: 'account', accountId: String(pay.accountId || '') },
          done: (it.done && typeof it.done === 'object') ? it.done : {},
          memo: String(it.memo || '').slice(0, 80)
        };
      });
    }
    if (Array.isArray(raw.txns)) {
      s.txns = raw.txns.filter(function (t) { return t && typeof t === 'object'; }).map(function (t) {
        var pay = t.pay || {};
        var type = pay.type === 'account' || pay.type === 'cash' ? pay.type : 'card';
        return {
          id: String(t.id || uid('tx_')),
          date: parseYmd(t.date) ? String(t.date) : ymd(new Date()),
          amount: Math.max(0, Math.round(num(t.amount))),
          categoryId: String(t.categoryId || s.categories[0].id),
          sub: String(t.sub || '기타').slice(0, 20),
          pay: type === 'card'
            ? { type: 'card', cardId: String(pay.cardId || '') }
            : type === 'account'
              ? { type: 'account', accountId: String(pay.accountId || '') }
              : { type: 'cash' },
          memo: String(t.memo || '').slice(0, 80),
          createdAt: String(t.createdAt || new Date().toISOString())
        };
      });
    }
    if (Array.isArray(raw.favorites)) {
      s.favorites = raw.favorites.filter(function (f) { return f && typeof f === 'object'; }).map(function (f) {
        return {
          id: String(f.id || uid('fav_')),
          label: String(f.label || '자주 쓰는 내역').slice(0, 20),
          amount: Math.max(0, Math.round(num(f.amount))),
          categoryId: String(f.categoryId || s.categories[0].id),
          sub: String(f.sub || '기타').slice(0, 20),
          pay: f.pay && f.pay.type === 'account'
            ? { type: 'account', accountId: String(f.pay.accountId || '') }
            : f.pay && f.pay.type === 'cash'
              ? { type: 'cash' }
              : { type: 'card', cardId: String((f.pay && f.pay.cardId) || '') }
        };
      });
    }
    if (raw.meta && typeof raw.meta === 'object') {
      s.meta = {
        sample: !!raw.meta.sample,
        welcome: !!raw.meta.welcome,
        createdAt: String(raw.meta.createdAt || new Date().toISOString())
      };
    }
    return s;
  }

  /* ---------- 샘플 데이터 (완전히 일반화된 예시) ---------- */
  function sampleDate(p, daysAgo) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    if (d < p.start || d >= p.end) d = new Date(p.start.getTime());
    d.setDate(d.getDate() - daysAgo);
    if (d < p.start) d = new Date(p.start.getTime());
    if (d >= p.end) d = new Date(p.end.getTime() - 86400000);
    return ymd(d);
  }

  function makeSample() {
    var s = baseState();
    s.meta.sample = true;
    s.meta.welcome = true;
    s.items = [
      { id: 'it_salary', name: '월급', kind: 'income', amount: 3200000, schedule: { type: 'monthly', day: 25 }, pay: { type: 'account', accountId: 'acc_main' }, done: {}, memo: '실수령액 기준' },
      { id: 'it_side', name: '부수입', kind: 'income', amount: 350000, schedule: { type: 'monthly', day: 10 }, pay: { type: 'account', accountId: 'acc_main' }, done: {}, memo: '' },
      { id: 'it_rent', name: '아파트 관리비', kind: 'fixed', amount: 220000, schedule: { type: 'monthly', day: 25 }, pay: { type: 'account', accountId: 'acc_main' }, done: {}, memo: '' },
      { id: 'it_tel', name: '통신비', kind: 'fixed', amount: 55000, schedule: { type: 'monthly', day: 18 }, pay: { type: 'card', cardId: 'card_a' }, done: {}, memo: '' },
      { id: 'it_sub', name: '구독료', kind: 'fixed', amount: 17000, schedule: { type: 'monthly', day: 12 }, pay: { type: 'card', cardId: 'card_b' }, done: {}, memo: '영상·음악' },
      { id: 'it_loan', name: '주택대출', kind: 'loan', amount: 800000, schedule: { type: 'monthly', day: 5 }, pay: { type: 'account', accountId: 'acc_main' }, done: {}, memo: '원리금' },
      { id: 'it_saving', name: '적금', kind: 'savings', amount: 300000, schedule: { type: 'monthly', day: 26 }, pay: { type: 'account', accountId: 'acc_main' }, done: {}, memo: '' },
      { id: 'it_invest', name: '투자/연금', kind: 'savings', amount: 250000, schedule: { type: 'monthly', day: 26 }, pay: { type: 'account', accountId: 'acc_main' }, done: {}, memo: '연금저축·IRP' }
    ];
    var p = periodOf(currentMonthKey());
    s.txns = [
      { id: 'tx_s1', date: sampleDate(p, 1), amount: 62400, categoryId: 'cat_food', sub: '장보기', pay: { type: 'card', cardId: 'card_a' }, memo: '동네 마트', createdAt: '2026-01-01T00:00:01Z' },
      { id: 'tx_s2', date: sampleDate(p, 2), amount: 28000, categoryId: 'cat_food', sub: '외식', pay: { type: 'card', cardId: 'card_b' }, memo: '점심 식당', createdAt: '2026-01-01T00:00:02Z' },
      { id: 'tx_s3', date: sampleDate(p, 3), amount: 6500, categoryId: 'cat_food', sub: '카페', pay: { type: 'card', cardId: 'card_b' }, memo: '스타벅스', createdAt: '2026-01-01T00:00:03Z' },
      { id: 'tx_s4', date: sampleDate(p, 4), amount: 55000, categoryId: 'cat_transport', sub: '주유', pay: { type: 'card', cardId: 'card_a' }, memo: '주유소', createdAt: '2026-01-01T00:00:04Z' },
      { id: 'tx_s5', date: sampleDate(p, 5), amount: 9800, categoryId: 'cat_health', sub: '약국', pay: { type: 'cash' }, memo: '약국', createdAt: '2026-01-01T00:00:05Z' },
      { id: 'tx_s6', date: sampleDate(p, 6), amount: 18000, categoryId: 'cat_living', sub: '생활용품', pay: { type: 'card', cardId: 'card_a' }, memo: '다이소', createdAt: '2026-01-01T00:00:06Z' },
      { id: 'tx_s7', date: sampleDate(p, 7), amount: 100000, categoryId: 'cat_event', sub: '경조사', pay: { type: 'account', accountId: 'acc_main' }, memo: '결혼식 축의금', createdAt: '2026-01-01T00:00:07Z' }
    ];
    s.favorites = [
      { id: 'fav_coffee', label: '아메리카노', amount: 4500, categoryId: 'cat_food', sub: '카페', pay: { type: 'card', cardId: 'card_a' } },
      { id: 'fav_lunch', label: '점심 한 끼', amount: 9000, categoryId: 'cat_food', sub: '외식', pay: { type: 'card', cardId: 'card_b' } },
      { id: 'fav_mart', label: '장보기', amount: 50000, categoryId: 'cat_food', sub: '장보기', pay: { type: 'card', cardId: 'card_a' } }
    ];
    return s;
  }

  /* ---------- 상태 ---------- */
  function currentMonthKey() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
    for (var i = 0; i < 3; i++) {
      var p = periodOf(key);
      if (d < p.start) key = shiftKey(key, -1);
      else if (d >= p.end) key = shiftKey(key, 1);
      else return key;
    }
    return key;
  }
  function shiftKey(key, delta) {
    var p = key.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  // 한 달의 기준: 시작일이 늦으면(예: 25일) 그 달의 대부분이 다음 달에 걸치므로
  // 기간의 끝이 그 달에 오도록 한 달 전에 시작합니다. (11월 = 10.25 ~ 11.24)
  // 시작일이 16일 이하이면 그 달 안에서 시작합니다. (11월 = 11.1 ~ 11.30)
  // 16/17일 경계는 월마다 날수가 달라도 같은 규칙을 써서 기간이 겹치거나 비지 않게 합니다.
  function periodOf(key) {
    var p = key.split('-').map(Number);
    var sd = state ? state.settings.monthStartDay : 25;
    var y = p[0], m = p[1]; // m은 1-based, key가 가리키는 달
    var start = new Date(y, m - 1, sd);
    if (sd >= 17) start = new Date(y, m - 2, sd);
    var end = new Date(start.getFullYear(), start.getMonth() + 1, sd);
    return { start: start, end: end, key: key };
  }
  function periodLabel(p) {
    var e = new Date(p.end.getTime());
    e.setDate(e.getDate() - 1);
    return (p.start.getMonth() + 1) + '.' + p.start.getDate() + ' – ' + (e.getMonth() + 1) + '.' + e.getDate();
  }
  function monthTitle(key) {
    var p = key.split('-').map(Number);
    return p[0] + '년 ' + p[1] + '월';
  }
  function inPeriod(dateStr, p) {
    var d = parseYmd(dateStr);
    return !!d && d >= p.start && d < p.end;
  }

  var state;
  var ui = {
    tab: 'summary',
    month: null,
    quick: null,
    sheetOpen: false,
    confirmResolve: null,
    undo: null,
    toastTimer: null
  };

  function load() {
    var raw = storage.read();
    if (raw) {
      try { return normalize(JSON.parse(raw)); } catch (e) { /* 손상된 저장본은 샘플로 대체 */ }
    }
    var s = makeSample();
    storage.write(JSON.stringify(s));
    return s;
  }
  state = load();
  ui.month = currentMonthKey();
  ui.quick = defaultQuick();

  function save() {
    try { storage.write(JSON.stringify(state)); } catch (e) { /* 저장 실패는 조용히 무시 */ }
  }

  function defaultQuick() {
    var p = periodOf(state ? currentMonthKey() : ui.month || '2026-11');
    var today = new Date();
    var date = ymd(today);
    if (!inPeriod(date, p)) date = ymd(p.start);
    var cat = state && state.categories.length ? state.categories[0] : { id: 'cat_etc', subs: ['기타'] };
    return {
      amount: '',
      date: date,
      categoryId: cat.id,
      sub: (cat.subs && cat.subs[0]) || '기타',
      method: state && state.cards.length ? 'card' : 'cash',
      cardId: state && state.cards.length ? state.cards[0].id : '',
      accountId: state && state.accounts.length ? state.accounts[0].id : '',
      memo: '',
      catManual: false
    };
  }

  /* ---------- 계산 ---------- */
  function occurrences(item, p) {
    var out = [];
    var sch = item.schedule || { type: 'monthly', day: 1 };
    if (sch.type === 'weekly') {
      var d = new Date(p.start.getTime());
      while (d < p.end) {
        if (d.getDay() === (sch.weekday | 0)) out.push(new Date(d.getTime()));
        d.setDate(d.getDate() + 1);
      }
      return out;
    }
    var day = clamp(Math.round(num(sch.day)) || 1, 1, 31);
    var y = p.start.getFullYear();
    var m = p.start.getMonth();
    if (day < p.start.getDate()) m += 1;
    var dim = new Date(y, m + 1, 0).getDate();
    out.push(new Date(y, m, Math.min(day, dim)));
    return out;
  }

  function analyze(key) {
    var p = periodOf(key);
    var rows = state.items.map(function (item) {
      var dates = occurrences(item, p);
      return {
        item: item,
        dates: dates,
        total: Math.round(num(item.amount)) * dates.length,
        done: !!(item.done && item.done[key]),
        days: dates.length
      };
    }).filter(function (r) { return r.days > 0; });
    var kindOrder = { income: 0, fixed: 1, loan: 2, savings: 3 };
    function ko(k) { return kindOrder[k] === undefined ? 9 : kindOrder[k]; }
    rows.sort(function (a, b) {
      return (a.dates[0] - b.dates[0]) || (ko(a.item.kind) - ko(b.item.kind)) ||
        a.item.name.localeCompare(b.item.name, 'ko');
    });

    function kindRows(k) { return rows.filter(function (r) { return r.item.kind === k; }); }
    var income = sum(kindRows('income'), function (r) { return r.total; });
    var fixed = sum(kindRows('fixed'), function (r) { return r.total; });
    var loan = sum(kindRows('loan'), function (r) { return r.total; });
    var savings = sum(kindRows('savings'), function (r) { return r.total; });
    var txs = state.txns.filter(function (t) { return inPeriod(t.date, p); }).slice().sort(function (a, b) {
      return b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt));
    });
    var variable = sum(txs, function (t) { return num(t.amount); });
    var totalOut = fixed + loan + savings + variable;
    var available = income - totalOut;
    var savingsRate = income > 0 ? (savings / income) * 100 : 0;

    var outflows = rows.filter(function (r) { return r.item.kind !== 'income'; });
    function isAccount(r) { return r.item.pay && r.item.pay.type === 'account'; }
    function isCard(r) { return r.item.pay && r.item.pay.type === 'card'; }
    var cashFixed = sum(outflows.filter(function (r) { return isAccount(r) || (r.item.pay && r.item.pay.type === 'cash'); }), function (r) { return r.total; });
    var cardFixed = sum(outflows.filter(isCard), function (r) { return r.total; });
    var cardVariable = sum(txs.filter(function (t) { return t.pay && t.pay.type === 'card'; }), function (t) { return num(t.amount); });

    var cards = state.cards.map(function (c) {
      var cf = sum(outflows.filter(function (r) { return isCard(r) && r.item.pay.cardId === c.id; }), function (r) { return r.total; });
      var cv = sum(txs.filter(function (t) { return t.pay && t.pay.type === 'card' && t.pay.cardId === c.id; }), function (t) { return num(t.amount); });
      return { card: c, fixed: cf, variable: cv, total: cf + cv, linked: !!byId(state.accounts, c.accountId) };
    });

    var accounts = state.accounts.map(function (a) {
      var af = sum(outflows.filter(function (r) { return isAccount(r) && r.item.pay.accountId === a.id; }), function (r) { return r.total; });
      var ac = sum(cards.filter(function (x) { return x.card.accountId === a.id; }), function (x) { return x.total; });
      return { account: a, fixed: af, cardCharges: ac, total: af + ac };
    });

    var knownCardIds = state.cards.map(function (c) { return c.id; });
    var knownAccIds = state.accounts.map(function (a) { return a.id; });
    var orphanCardFixed = sum(outflows.filter(function (r) {
      return isCard(r) && knownCardIds.indexOf(r.item.pay.cardId) === -1;
    }), function (r) { return r.total; });
    var orphanAccountFixed = sum(outflows.filter(function (r) {
      return isAccount(r) && knownAccIds.indexOf(r.item.pay.accountId) === -1;
    }), function (r) { return r.total; });

    var cardTotal = sum(cards, function (c) { return c.total; }) + orphanCardFixed;
    var spentByCat = {};
    txs.forEach(function (t) {
      spentByCat[t.categoryId] = (spentByCat[t.categoryId] || 0) + num(t.amount);
    });

    var doneCount = rows.filter(function (r) { return r.done; }).length;

    return {
      period: p,
      periodLabel: periodLabel(p),
      monthTitle: monthTitle(key),
      rows: rows,
      txs: txs,
      income: income, fixed: fixed, loan: loan, savings: savings, variable: variable,
      totalOut: totalOut, available: available, savingsRate: savingsRate,
      cashFixed: cashFixed, cardFixed: cardFixed, cardVariable: cardVariable,
      cards: cards, accounts: accounts, cardTotal: cardTotal,
      orphanCardFixed: orphanCardFixed, orphanAccountFixed: orphanAccountFixed,
      spentByCat: spentByCat, doneCount: doneCount
    };
  }

  /* ---------- 렌더 도우미 ---------- */
  function kindChip(kind) {
    var k = KIND[kind] || KIND.fixed;
    return '<span class="chip chip--tiny ' + k.chip + '">' + k.label + '</span>';
  }
  function payName(pay) {
    if (!pay) return '현금';
    if (pay.type === 'cash') return '현금';
    if (pay.type === 'card') {
      var c = byId(state.cards, pay.cardId);
      return c ? c.name : '카드 미지정';
    }
    var a = byId(state.accounts, pay.accountId);
    return a ? a.name : '통장 미지정';
  }
  function payIcon(pay) {
    if (pay && pay.type === 'card') return '카드';
    if (pay && pay.type === 'account') return '계좌';
    return '현금';
  }
  function catById(id) { return byId(state.categories, id) || { name: '기타', subs: ['기타'] }; }
  function dateBadgeParts(d, weekly) {
    if (weekly) return { top: WEEKDAYS[d.getDay()], bottom: '매주' };
    return { top: String(d.getDate()), bottom: (d.getMonth() + 1) + '월' };
  }

  /* ---------- 화면 ---------- */
  function render() {
    var sub = { summary: '이번 달 요약', fixed: '고정·계획 (결제일순)', variable: '변동·일상 빠른 입력', settings: '설정·백업' }[ui.tab];
    document.getElementById('topbar-sub').textContent = sub;
    document.getElementById('month-label').textContent = monthTitle(ui.month);
    document.getElementById('period-label').textContent = periodLabel(periodOf(ui.month));
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].setAttribute('aria-selected', String(tabs[i].getAttribute('data-tab') === ui.tab));
    }
    var a = analyze(ui.month);
    var view = document.getElementById('view');
    var scroll = window.scrollY;
    if (ui.tab === 'summary') view.innerHTML = viewSummary(a);
    else if (ui.tab === 'fixed') view.innerHTML = viewFixed(a);
    else if (ui.tab === 'variable') view.innerHTML = viewVariable(a);
    else view.innerHTML = viewSettings(a);
    window.scrollTo(0, Math.min(scroll, document.body.scrollHeight));
  }

  function welcomeBanner() {
    if (!state.meta.welcome) return '';
    return '<div class="welcome">' +
      '<b>예시 데이터로 둘러보는 중이에요</b>' +
      '<p>모든 금액과 항목은 일반화된 예시입니다. 자유롭게 고치거나, 빈 장부로 시작해 내 기록만 남길 수 있어요.</p>' +
      '<div class="btn-row"><button class="btn" type="button" data-act="sample-clear">빈 장부로 시작</button>' +
      '<button class="btn" type="button" data-act="welcome-close">예시로 둘러보기</button></div></div>';
  }

  function viewSummary(a) {
    var income = Math.max(a.income, 1);
    var seg = function (v, color) {
      var w = clamp((v / Math.max(a.income, a.totalOut, 1)) * 100, 0, 100);
      return w > 0 ? '<span style="width:' + w.toFixed(2) + '%;background:' + color + '"></span>' : '';
    };
    var bar = seg(a.fixed, '#8fd6b8') + seg(a.loan, '#e7b06a') + seg(a.savings, '#b9a3e8') + seg(a.variable, '#f0a184');

    function sumRow(kind, value, note) {
      var k = SUMKIND[kind];
      var share = a.income > 0 ? (value / a.income) * 100 : 0;
      return '<div class="sumrow">' +
        '<span class="sumrow__dot ' + k.dot + '"></span>' +
        '<div class="sumrow__label"><b>' + k.label + '</b><small>' + note + '</small></div>' +
        '<div class="sumrow__amount" data-test="sum-' + kind + '">' + money(value) + '<small>수입의 ' + pct(share) + '</small></div>' +
        '</div>';
    }

    var orphanCard = a.orphanCardFixed > 0
      ? '<div class="notice" style="margin-top:10px">카드가 지정되지 않은 카드 고정비 <b>' + money(a.orphanCardFixed) + '</b>이 있어요. 고정·계획 탭에서 결제수단을 골라 주세요.</div>' : '';
    var orphanAcc = a.orphanAccountFixed > 0
      ? '<div class="notice" style="margin-top:10px">통장이 지정되지 않은 고정비 <b>' + money(a.orphanAccountFixed) + '</b>이 있어요. 설정에서 통장을 추가하거나 항목을 고쳐 주세요.</div>' : '';

    var cardRows = a.cards.length ? a.cards.map(function (c) {
      var acc = byId(state.accounts, c.card.accountId);
      var sub = '고정 ' + wonPlain(c.fixed) + ' + 변동 ' + wonPlain(c.variable) + '원';
      return '<div class="payrow" data-test="card-charge" data-name="' + esc(c.card.name) + '" data-amount="' + c.total + '">' +
        '<div class="payrow__icon payrow__icon--card">카드</div>' +
        '<div class="payrow__main"><div class="payrow__name"><span class="truncate">' + esc(c.card.name) + '</span>' +
        '<span class="badge-day">' + c.card.billingDay + '일 결제</span>' +
        (c.linked ? '' : '<span class="badge-warn">통장 미연결</span>') + '</div>' +
        '<div class="payrow__sub">' + (acc ? esc(acc.name) : '연결 통장 없음') + ' · ' + sub + '</div></div>' +
        '<div class="payrow__amount" data-test="card-charge-amount">' + money(c.total) + '</div></div>';
    }).join('') : '<div class="empty">등록된 카드가 없어요.<br>설정·백업에서 카드를 추가해 보세요.</div>';

    var accRows = a.accounts.length ? a.accounts.map(function (x) {
      return '<div class="payrow" data-test="account-need" data-name="' + esc(x.account.name) + '" data-amount="' + x.total + '">' +
        '<div class="payrow__icon">통장</div>' +
        '<div class="payrow__main"><div class="payrow__name"><span class="truncate">' + esc(x.account.name) + '</span></div>' +
        '<div class="payrow__sub">현금 고정 ' + wonPlain(x.fixed) + ' + 카드 청구 ' + wonPlain(x.cardCharges) + '원</div></div>' +
        '<div class="payrow__amount" data-test="account-need-amount">' + money(x.total) + '</div></div>';
    }).join('') : '<div class="empty">등록된 통장이 없어요.</div>';

    return '<div class="stack">' + welcomeBanner() +
      '<section class="hero">' +
      '<div class="hero__label">이번 기간 가용 잔액 <span style="opacity:.7">· 수입 − 총 출금</span></div>' +
      '<div class="hero__amount' + (a.available < 0 ? ' is-negative' : '') + '" data-test="sum-available">' + money(a.available) + '</div>' +
      '<div class="hero__meta">' +
      '<span class="hero__pill">수입 <b data-test="hero-income">' + wonPlain(a.income) + '</b></span>' +
      '<span class="hero__pill">총 출금 <b data-test="hero-total-out">' + wonPlain(a.totalOut) + '</b></span>' +
      '<span class="hero__pill">저축률 <b data-test="savings-rate">' + pct(a.savingsRate) + '</b></span>' +
      '</div>' +
      '<div class="hero__bar">' + bar + '</div>' +
      '<div class="hero__legend"><span><i style="background:#8fd6b8"></i>고정비</span><span><i style="background:#e7b06a"></i>대출</span><span><i style="background:#b9a3e8"></i>저축·투자</span><span><i style="background:#f0a184"></i>변동</span></div>' +
      '</section>' +

      '<section class="card">' +
      '<div class="card__head"><h2>이번 달 요약</h2><span class="hint">' + a.periodLabel + '</span></div>' +
      '<div class="sumlist">' +
      sumRow('income', a.income, '급여·부수입 등 들어온 돈') +
      sumRow('fixed', a.fixed, '관리비·통신비 등 순수 생활 고정비') +
      sumRow('loan', a.loan, '원리금 상환') +
      sumRow('savings', a.savings, '적금·연금 등 자산 이동') +
      sumRow('variable', a.variable, '이번 기간 카드·현금 소비') +
      '<div class="sumrow sumrow--total"><span></span><div class="sumrow__label"><b>총 출금</b><small>고정비 + 대출 + 저축·투자 + 변동</small></div>' +
      '<div class="sumrow__amount" data-test="sum-total-out">' + money(a.totalOut) + '</div></div>' +
      '</div>' +
      '<p class="notice">저축·투자는 소비가 아니라 <b>자산 이동</b>이에요. 따로 빼서 보여 주지만, 통장에서 나가는 돈이라 총 출금과 가용 잔액에는 포함됩니다.</p>' +
      '</section>' +

      '<section class="card">' +
      '<div class="card__head"><h2>현금흐름 &amp; 카드값 예측</h2><span class="hint">이번 기간 기준</span></div>' +
      '<div class="tiles">' +
      '<div class="tile"><div class="tile__label">현금(계좌)<br>고정비</div><div class="tile__value" data-test="cash-fixed">' + money(a.cashFixed) + '</div></div>' +
      '<div class="tile"><div class="tile__label">카드<br>고정비</div><div class="tile__value" data-test="card-fixed">' + money(a.cardFixed) + '</div></div>' +
      '<div class="tile"><div class="tile__label">카드<br>변동 사용</div><div class="tile__value" data-test="card-variable">' + money(a.cardVariable) + '</div></div>' +
      '</div>' +
      '<p class="notice" style="margin-top:10px">세 항목을 더하면 이번 기간의 <b>고정비·대출·저축·투자</b> 합계가 돼요. 현금 지출은 어느 통장에서도 빠지지 않으므로 통장별 잔액 계산에서는 빠집니다.</p>' +
      '<div class="card__head" style="margin:16px 0 6px"><h2 style="font-size:13px">카드별 예상 청구액</h2><span class="hint">결제일순</span></div>' +
      '<div class="paylist">' + cardRows +
      '<div class="payrow payrow--sum"><div class="payrow__icon payrow__icon--card">합계</div>' +
      '<div class="payrow__main"><div class="payrow__name">카드 청구 예상 합계</div><div class="payrow__sub">카드 고정비 + 카드 변동 사용액</div></div>' +
      '<div class="payrow__amount" data-test="card-total">' + money(a.cardTotal) + '</div></div></div>' + orphanCard +
      '<p class="notice">카드 청구액은 위 소비 요약에 다시 더하지 않았어요. 같은 돈이 두 번 잡히지 않도록 <b>소비 통계와 청구 예측을 따로</b> 계산합니다.</p>' +
      '</section>' +

      '<section class="card">' +
      '<div class="card__head"><h2>통장별 필요 잔액</h2><span class="hint">현금 고정비 + 카드 청구</span></div>' +
      '<div class="paylist">' + accRows +
      '<div class="payrow payrow--sum"><div class="payrow__icon">합계</div>' +
      '<div class="payrow__main"><div class="payrow__name">필요 잔액 합계</div><div class="payrow__sub">이미 나간 변동 지출은 제외</div></div>' +
      '<div class="payrow__amount" data-test="account-total">' + money(sum(a.accounts, function (x) { return x.total; }) + a.orphanAccountFixed) + '</div></div></div>' + orphanAcc +
      '</section>' +

      '<section class="card card--flat">' +
      '<div class="kv"><span>이번 기간 고정 항목 처리</span><b>' + a.doneCount + ' / ' + a.rows.length + '개</b></div>' +
      '<div class="kv"><span>카드 청구 예상</span><b>' + money(a.cardTotal) + '</b></div>' +
      '<div class="kv"><span>기록된 변동 내역</span><b>' + a.txs.length + '건</b></div>' +
      '</section>' +
      '</div>';
  }

  function viewFixed(a) {
    var planRows = a.rows.map(function (r) {
      var item = r.item;
      var d = r.dates[0];
      var weekly = item.schedule.type === 'weekly';
      var b = dateBadgeParts(d, weekly);
      var unit = weekly ? '회' : '';
      var datesText = weekly ? r.dates.map(function (x) { return (x.getMonth() + 1) + '/' + x.getDate(); }).join(' · ') : '';
      return '<div class="plan' + (r.done ? ' is-done' : '') + '">' +
        '<div class="plan__date' + (weekly ? ' plan__date--weekly' : '') + (r.done ? ' is-done' : '') + '"><b>' + b.top + '</b><span>' + b.bottom + '</span></div>' +
        '<button type="button" class="plan__main" data-act="item-edit" data-id="' + item.id + '">' +
        '<div class="plan__name">' + esc(item.name) + '</div>' +
        '<div class="plan__meta">' + kindChip(item.kind) +
        '<span>' + payIcon(item.pay) + ' · ' + esc(payName(item.pay)) + '</span>' +
        (weekly ? '<span>' + r.days + '회 · ' + datesText + '</span>' : '') +
        (item.memo ? '<span>· ' + esc(item.memo) + '</span>' : '') +
        '</div></button>' +
        '<div class="plan__right"><div class="plan__amount">' + money(r.total) +
        (weekly ? '<small>' + wonPlain(item.amount) + '원 × ' + r.days + unit + '</small>' : '') + '</div>' +
        '<button type="button" class="check" data-act="item-done" data-id="' + item.id + '" aria-pressed="' + r.done + '" aria-label="' + esc(item.name) + ' 처리 완료">' +
        '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
        '</div>';
    }).join('');

    var empty = '<div class="empty"><b>아직 고정 항목이 없어요</b>월급·관리비·대출·적금처럼 매달 반복되는 항목을 추가하면 결제일순으로 정리해 드려요.<br><br><button class="btn btn--soft" type="button" data-act="item-new">+ 첫 항목 추가</button></div>';

    return '<div class="stack">' +
      '<section class="tiles tiles--2">' +
      '<div class="tile"><div class="tile__label">수입</div><div class="tile__value" data-test="fixed-income">' + money(a.income) + '</div></div>' +
      '<div class="tile"><div class="tile__label">고정생활비</div><div class="tile__value" data-test="fixed-fixed">' + money(a.fixed) + '</div></div>' +
      '<div class="tile"><div class="tile__label">대출 상환</div><div class="tile__value" data-test="fixed-loan">' + money(a.loan) + '</div></div>' +
      '<div class="tile"><div class="tile__label">저축·투자</div><div class="tile__value" data-test="fixed-savings">' + money(a.savings) + '</div></div>' +
      '</section>' +
      '<div class="toolbar"><div class="toolbar__title">' + a.periodLabel + ' · 결제일순</div>' +
      '<button class="btn btn--primary btn--sm" type="button" data-act="item-new">+ 항목 추가</button></div>' +
      '<section class="card">' +
      (a.rows.length ? '<div class="planlist">' + planRows + '</div>' : empty) +
      '</section>' +
      '<p class="notice">행을 누르면 수정·삭제할 수 있어요. 오른쪽 네모를 누르면 이번 달 처리 완료로 표시됩니다. 월 시작일이 <b>' + state.settings.monthStartDay + '일</b>이라 그보다 앞선 결제일은 다음 달 날짜로 표시돼요.</p>' +
      '</div>';
  }

  function quickCatChips() {
    return state.categories.map(function (c) {
      return '<button type="button" class="chip' + (c.id === ui.quick.categoryId ? ' is-active' : '') + '" data-act="q-cat" data-id="' + c.id + '">' + esc(c.name) + '</button>';
    }).join('');
  }
  function quickSubChips() {
    var c = catById(ui.quick.categoryId);
    var subs = (c.subs && c.subs.length ? c.subs : ['기타']);
    if (subs.indexOf(ui.quick.sub) === -1) ui.quick.sub = subs[0];
    return subs.map(function (s) {
      return '<button type="button" class="chip chip--ghost' + (s === ui.quick.sub ? ' is-active' : '') + '" data-act="q-sub" data-sub="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');
  }

  function viewVariable(a) {
    var favs = state.favorites.length ? state.favorites.map(function (f) {
      return '<button type="button" class="chip" data-act="fav-use" data-id="' + f.id + '">' + esc(f.label) + ' · ' + wonPlain(f.amount) + '원</button>';
    }).join('') : '<span style="font-size:11.5px;color:var(--muted)">설정에서 자주 쓰는 내역을 추가할 수 있어요.</span>';

    var budgets = state.categories.filter(function (c) { return c.budget > 0; }).map(function (c) {
      var spent = a.spentByCat[c.id] || 0;
      var ratio = c.budget > 0 ? (spent / c.budget) * 100 : 0;
      var cls = ratio > 100 ? ' is-over' : ratio >= 80 ? ' is-warn' : '';
      return '<div class="budget__row' + (ratio > 100 ? ' is-over' : '') + '" data-test="budget-row" data-cat="' + esc(c.name) + '" data-spent="' + spent + '" data-budget="' + c.budget + '">' +
        '<div class="budget__top"><div class="budget__name">' + esc(c.name) + '</div>' +
        '<div class="budget__nums"><b>' + wonPlain(spent) + '</b> / ' + wonPlain(c.budget) + '원 · ' + pct(ratio) + '</div></div>' +
        '<div class="budget__track"><div class="budget__fill' + (ratio > 100 ? ' is-over' : '') + '" style="width:' + clamp(ratio, 0, 100).toFixed(1) + '%"></div></div></div>';
    }).join('');

    var txRows = a.txs.slice(0, 50).map(function (t) {
      var d = parseYmd(t.date);
      var c = catById(t.categoryId);
      return '<div class="txn">' +
        '<div class="txn__date"><b>' + d.getDate() + '</b><span>' + (d.getMonth() + 1) + '월</span></div>' +
        '<button type="button" class="txn__main" data-act="txn-edit" data-id="' + t.id + '">' +
        '<div class="txn__name">' + esc(t.memo || (c.name + ' · ' + t.sub)) + '</div>' +
        '<div class="txn__meta"><span class="chip chip--tiny chip--variable">' + esc(c.name) + '</span><span>' + esc(t.sub) + '</span></div>' +
        '</button>' +
        '<div class="txn__right"><div class="txn__amount">' + money(t.amount) + '</div>' +
        '<div class="txn__pay">' + esc(payName(t.pay)) + '</div></div>' +
        '</div>';
    }).join('');

    var paySelect = '';
    if (ui.quick.method === 'card') {
      paySelect = '<select class="select" id="q-card" aria-label="카드 선택">' +
        (state.cards.length ? state.cards.map(function (c) {
          return '<option value="' + c.id + '"' + (c.id === ui.quick.cardId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('') : '<option value="">카드 없음</option>') + '</select>';
    } else if (ui.quick.method === 'account') {
      paySelect = '<select class="select" id="q-account" aria-label="통장 선택">' +
        (state.accounts.length ? state.accounts.map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === ui.quick.accountId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
        }).join('') : '<option value="">통장 없음</option>') + '</select>';
    } else {
      paySelect = '<div class="input" style="display:flex;align-items:center;color:var(--muted)">현금 지출</div>';
    }

    var today = ymd(new Date());
    if (!inPeriod(ui.quick.date, a.period)) ui.quick.date = inPeriod(today, a.period) ? today : ymd(a.period.start);

    return '<div class="stack">' +
      '<section class="card quick">' +
      '<div class="quick__amount"><input id="q-amount" data-test="quick-amount" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="금액" value="' + (ui.quick.amount ? Number(ui.quick.amount).toLocaleString('ko-KR') : '') + '"><span>원</span></div>' +
      '<div class="quick__row">' +
      '<input class="input input--date" id="q-date" type="date" value="' + ui.quick.date + '" aria-label="날짜" style="flex:0 0 46%">' +
      '<div class="seg" id="q-method-seg" style="flex:1">' +
      '<button type="button" data-act="q-method" data-method="card" class="' + (ui.quick.method === 'card' ? 'is-active' : '') + '">카드</button>' +
      '<button type="button" data-act="q-method" data-method="account" class="' + (ui.quick.method === 'account' ? 'is-active' : '') + '">계좌</button>' +
      '<button type="button" data-act="q-method" data-method="cash" class="' + (ui.quick.method === 'cash' ? 'is-active' : '') + '">현금</button>' +
      '</div></div>' +
      '<div id="q-pay-select" style="margin-top:8px">' + paySelect + '</div>' +
      '<div class="field-label">대분류</div><div class="chips" id="quick-cat">' + quickCatChips() + '</div>' +
      '<div class="field-label">소분류</div><div class="chips" id="quick-sub">' + quickSubChips() + '</div>' +
      '<div class="quick__memo-wrap"><input class="quick__memo" id="q-memo" maxlength="40" placeholder="메모 (예: 스타벅스, 코스트코)" value="' + esc(ui.quick.memo) + '" aria-label="메모"></div>' +
      '<div class="auto-hint" id="q-hint"></div>' +
      '<button class="btn btn--primary btn--block" type="button" data-act="q-save" data-test="q-save">기록하기</button>' +
      '</section>' +

      '<section class="card"><div class="card__head"><h2>자주 쓰는 내역</h2>' +
      '<button class="btn btn--sm" type="button" data-act="fav-new">+ 추가</button></div>' +
      '<div class="chips chips--scroll">' + favs + '</div></section>' +

      '<section class="card"><div class="card__head"><h2>카테고리별 예산</h2><span class="hint">이번 기간</span></div>' +
      (budgets ? '<div class="budget">' + budgets + '</div>' : '<div class="empty">예산이 설정된 카테고리가 없어요.</div>') + '</section>' +

      '<section class="card"><div class="card__head"><h2>최근 내역</h2><span class="hint">' + a.txs.length + '건 · ' + money(a.variable) + '</span></div>' +
      (txRows ? '<div class="txnlist">' + txRows + '</div>' + (a.txs.length > 50 ? '<p class="notice">최근 50건까지 보여 드려요.</p>' : '') : '<div class="empty"><b>아직 변동 내역이 없어요</b>위에서 금액을 입력하고 기록해 보세요.<br>기록한 내역을 누르면 수정·삭제할 수 있어요.</div>') +
      '</section>' +
      '</div>';
  }

  function viewSettings(a) {
    var sd = state.settings.monthStartDay;
    var dayOpts = '';
    for (var i = 1; i <= 28; i++) dayOpts += '<option value="' + i + '"' + (i === sd ? ' selected' : '') + '>' + i + '일</option>';

    var accRows = state.accounts.length ? state.accounts.map(function (x) {
      return '<div class="manage__row"><div class="manage__name">' + esc(x.name) + '</div>' +
        '<button class="icon-btn" type="button" data-act="acc-del" data-id="' + x.id + '" aria-label="' + esc(x.name) + ' 삭제">' +
        '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    }).join('') : '<div class="empty" style="padding:12px">등록된 통장이 없어요.</div>';

    var cardRows = state.cards.length ? state.cards.map(function (c) {
      var acc = byId(state.accounts, c.accountId);
      return '<div class="manage__row"><div class="manage__name">' + esc(c.name) + '<div class="manage__sub">매월 ' + c.billingDay + '일 결제 · ' + (acc ? esc(acc.name) : '연결 통장 없음') + '</div></div>' +
        '<button class="icon-btn" type="button" data-act="card-edit" data-id="' + c.id + '" aria-label="' + esc(c.name) + ' 수정">' +
        '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>' +
        '<button class="icon-btn" type="button" data-act="card-del" data-id="' + c.id + '" aria-label="' + esc(c.name) + ' 삭제">' +
        '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    }).join('') : '<div class="empty" style="padding:12px">등록된 카드가 없어요.</div>';

    var favRows = state.favorites.length ? state.favorites.map(function (f) {
      var fc = catById(f.categoryId);
      return '<div class="manage__row"><div class="manage__name">' + esc(f.label) +
        '<div class="manage__sub">' + money(f.amount) + ' · ' + esc(fc.name) + ' · ' + esc(f.sub) + ' · ' + esc(payName(f.pay)) + '</div></div>' +
        '<button class="icon-btn" type="button" data-act="fav-edit" data-id="' + f.id + '" aria-label="' + esc(f.label) + ' 수정">' +
        '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>' +
        '<button class="icon-btn" type="button" data-act="fav-del" data-id="' + f.id + '" aria-label="' + esc(f.label) + ' 삭제">' +
        '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    }).join('') : '<div class="empty" style="padding:12px">자주 쓰는 내역이 없어요.</div>';

    var catRows = state.categories.map(function (c) {
      var spent = a.spentByCat[c.id] || 0;
      return '<div class="manage__row"><div class="manage__name">' + esc(c.name) + '<div class="manage__sub">예산 ' + wonPlain(c.budget) + '원 · 이번 기간 ' + wonPlain(spent) + '원</div></div>' +
        '<button class="icon-btn" type="button" data-act="cat-edit" data-id="' + c.id + '" aria-label="' + esc(c.name) + ' 수정">' +
        '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button></div>';
    }).join('');

    return '<div class="stack">' +
      '<section class="card"><div class="card__head"><h2>기간 기준</h2><span class="hint">급여일 기준</span></div>' +
      '<div class="setting-row"><div class="setting-row__main"><b>월 시작일</b><small>급여일(1~28일)로 맞추면 그날부터 다음 달 그 전날까지를 한 달로 봐요.</small></div>' +
      '<select class="select" id="set-start" style="width:96px;min-height:40px;font-size:14px" aria-label="월 시작일">' + dayOpts + '</select></div>' +
      '<div class="kv"><span>현재 기간</span><b>' + a.periodLabel + '</b></div>' +
      '<div class="kv"><span>이번 달 시작일</span><b>매월 ' + sd + '일</b></div>' +
      '<p class="notice">예: ' + sd + '일이면 이번 한 달이 <b>' + a.periodLabel + '</b>처럼 이어져요. 급여일을 바꾸면 위쪽 월 이동으로 기간을 확인하세요.</p></section>' +

      '<section class="card"><div class="card__head"><h2>통장</h2><span class="hint">계좌</span></div>' +
      '<div class="manage">' + accRows + '</div>' +
      '<div class="add-inline"><input class="input" id="new-acc" maxlength="20" placeholder="통장 이름" aria-label="새 통장 이름">' +
      '<button class="btn btn--soft" type="button" data-act="acc-add">추가</button></div></section>' +

      '<section class="card"><div class="card__head"><h2>카드</h2><span class="hint">결제일·연결 통장</span></div>' +
      '<div class="manage">' + cardRows + '</div>' +
      '<button class="btn btn--soft btn--block" type="button" data-act="card-new" style="margin-top:10px">+ 카드 추가</button></section>' +

      '<section class="card"><div class="card__head"><h2>변동비 카테고리</h2><span class="hint">이름·예산</span></div>' +
      '<div class="manage">' + catRows + '</div>' +
      '<button class="btn btn--soft btn--block" type="button" data-act="cat-new" style="margin-top:10px">+ 카테고리 추가</button></section>' +

      '<section class="card"><div class="card__head"><h2>자주 쓰는 내역</h2><span class="hint">원터치 기록</span></div>' +
      '<div class="manage">' + favRows + '</div>' +
      '<button class="btn btn--soft btn--block" type="button" data-act="fav-new" style="margin-top:10px">+ 즐겨찾기 추가</button></section>' +

      '<section class="card"><div class="card__head"><h2>데이터 백업</h2><span class="hint">이 기기에만 저장</span></div>' +
      '<div class="data-grid">' +
      '<button class="btn" type="button" data-act="export-json">JSON 내보내기</button>' +
      '<button class="btn" type="button" data-act="import-json">JSON 불러오기</button>' +
      '<button class="btn" type="button" data-act="export-csv">CSV 내보내기</button>' +
      '<button class="btn" type="button" data-act="sample-reset">예시로 채우기</button>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn btn--danger" type="button" data-act="clear-all">전체 비우기</button>' +
      '<button class="btn" type="button" data-act="sample-clear">빈 장부로 시작</button></div>' +
      '<p class="notice">JSON은 기기 이전·보관용 전체 백업이에요. CSV는 이번 기간 내역을 엑셀에서 열 수 있게 내보냅니다. 불러오면 현재 데이터를 덮어씁니다.</p></section>' +

      '<section class="card"><div class="card__head"><h2>정보</h2><span class="hint">v' + APP_VERSION + '</span></div>' +
      '<p class="privacy">모든 기록은 이 브라우저(localStorage)에만 저장되고 어떤 서버로도 전송되지 않아요. 브라우저 방문 기록·사이트 데이터를 지우면 기록도 함께 사라지니, 가끔 JSON으로 백업해 두세요.<br><br>' +
      '폰 홈 화면에 앱처럼 설치하려면 Chrome 오른쪽 위 메뉴 → <b>설치 및 바로가기 만들기</b>를 누르면 됩니다. 한 번 열어 두면 오프라인에서도 실행돼요.<br><br>' +
      '기록 ' + state.txns.length + '건 · 고정 항목 ' + state.items.length + '개 · 카테고리 ' + state.categories.length + '개</p></section>' +
      '</div>';
  }

  /* ---------- 시트 ---------- */
  var sheetEl = document.getElementById('sheet');
  var sheetBody = document.getElementById('sheet-body');
  var sheetTitle = document.getElementById('sheet-title');

  function openSheet(title, html) {
    if (ui.confirmResolve) { var r = ui.confirmResolve; ui.confirmResolve = null; r(false); }
    sheetTitle.textContent = title;
    sheetBody.innerHTML = html;
    sheetEl.hidden = false;
    document.body.style.overflow = 'hidden';
    ui.sheetOpen = true;
    var first = sheetBody.querySelector('input:not([type=hidden]), select');
    if (first && window.matchMedia('(min-width: 0px)').matches) {
      setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) {} }, 60);
    }
  }
  function closeSheet() {
    sheetEl.hidden = true;
    document.body.style.overflow = '';
    ui.sheetOpen = false;
    if (ui.confirmResolve) { var r = ui.confirmResolve; ui.confirmResolve = null; r(false); }
  }
  function askConfirm(title, message, confirmLabel, danger) {
    return new Promise(function (resolve) {
      openSheet(title, '<p class="sheet__note" style="font-size:13px;color:var(--ink-2);margin-top:4px">' + message + '</p>' +
        '<button class="btn ' + (danger === false ? 'btn--primary' : 'btn--danger') + ' btn--block" type="button" data-confirm="yes">' + esc(confirmLabel || '삭제') + '</button>' +
        '<button class="btn btn--block" type="button" data-confirm="no">취소</button>');
      ui.confirmResolve = resolve;
    });
  }

  /* ---------- 토스트 ---------- */
  function toast(message, undoFn) {
    var el = document.getElementById('toast');
    el.innerHTML = '<span>' + esc(message) + '</span>' + (undoFn ? '<button type="button" data-act="toast-undo">실행취소</button>' : '');
    ui.undo = undoFn || null;
    el.hidden = false;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { el.hidden = true; ui.undo = null; }, 3800);
  }

  /* ---------- 폼 ---------- */
  function opt(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function inp(name, value, attrs) {
    return '<input class="input" name="' + name + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
  }

  function sheetItem(item) {
    var isNew = !item;
    item = item || {
      name: '', kind: 'fixed', amount: '', schedule: { type: 'monthly', day: 1 },
      pay: { type: 'account', accountId: state.accounts[0] ? state.accounts[0].id : '' }, memo: ''
    };
    var kindOpts = Object.keys(KIND).map(function (k) { return opt(k, KIND[k].label, item.kind === k); }).join('');
    var dayOpts = '';
    for (var i = 1; i <= 31; i++) dayOpts += opt(i, i + '일', item.schedule.type !== 'weekly' && item.schedule.day === i);
    var wdOpts = WEEKDAYS.map(function (w, idx) { return opt(idx, '매주 ' + w + '요일', item.schedule.type === 'weekly' && item.schedule.weekday === idx); }).join('');
    var accOpts = state.accounts.length ? state.accounts.map(function (x) {
      return opt(x.id, x.name, item.pay.type === 'account' && item.pay.accountId === x.id);
    }).join('') : opt('', '통장 없음', true);
    var cardOpts = state.cards.length ? state.cards.map(function (c) {
      return opt(c.id, c.name, item.pay.type === 'card' && item.pay.cardId === c.id);
    }).join('') : opt('', '카드 없음', true);

    openSheet(isNew ? '고정 항목 추가' : '항목 수정',
      '<form data-form="item" data-id="' + (item.id || '') + '">' +
      '<label class="field-label">항목명</label>' +
      inp('name', item.name, 'maxlength="40" placeholder="예: 아파트 관리비" required') +
      '<div class="form-grid" style="margin-top:12px">' +
      '<div class="form-field"><label class="field-label">분류</label><select class="select" name="kind">' + kindOpts + '</select></div>' +
      '<div class="form-field"><label class="field-label">금액</label>' + inp('amount', item.amount ? Math.round(item.amount).toLocaleString('ko-KR') : '', 'inputmode="numeric" placeholder="0" required') + '</div>' +
      '</div>' +
      '<div class="form-grid" style="margin-top:12px">' +
      '<div class="form-field"><label class="field-label">반복</label><select class="select" name="schedType">' +
      opt('monthly', '매월', item.schedule.type !== 'weekly') + opt('weekly', '매주', item.schedule.type === 'weekly') + '</select></div>' +
      '<div class="form-field"><label class="field-label">결제일</label><div id="sched-day-wrap">' +
      (item.schedule.type === 'weekly' ? '<select class="select" name="weekday">' + wdOpts + '</select>' : '<select class="select" name="day">' + dayOpts + '</select>') + '</div></div>' +
      '</div>' +
      '<label class="field-label">결제수단</label><select class="select" name="payType">' +
      opt('account', '계좌', item.pay.type === 'account') + opt('card', '카드', item.pay.type === 'card') + opt('cash', '현금', item.pay.type === 'cash') + '</select>' +
      '<div id="pay-target-wrap" style="margin-top:8px">' +
      (item.pay.type === 'card' ? '<select class="select" name="cardId">' + cardOpts + '</select>'
        : item.pay.type === 'cash' ? '' : '<select class="select" name="accountId">' + accOpts + '</select>') + '</div>' +
      '<label class="field-label">메모 (선택)</label>' + inp('memo', item.memo || '', 'maxlength="80" placeholder="예: 원리금, 자동이체"') +
      '<p class="form-error" data-error></p>' +
      '<button class="btn btn--primary btn--block" type="submit">' + (isNew ? '추가' : '저장') + '</button>' +
      (isNew ? '' : '<button class="btn btn--danger btn--block" type="button" data-act="item-del" data-id="' + item.id + '">삭제</button>') +
      '</form>');
  }

  function syncItemForm(form) {
    var st = form.schedType.value;
    var wrap = form.querySelector('#sched-day-wrap');
    if (st === 'weekly') {
      var cur = wrap.querySelector('select') ? wrap.querySelector('select').value : 1;
      var opts = WEEKDAYS.map(function (w, idx) { return opt(idx, '매주 ' + w + '요일', String(idx) === String(cur)); }).join('');
      wrap.innerHTML = '<select class="select" name="weekday">' + opts + '</select>';
    } else {
      var cur2 = wrap.querySelector('select') ? wrap.querySelector('select').value : 1;
      var opts2 = '';
      for (var i = 1; i <= 31; i++) opts2 += opt(i, i + '일', String(i) === String(cur2));
      wrap.innerHTML = '<select class="select" name="day">' + opts2 + '</select>';
    }
    var pt = form.payType.value;
    var pwrap = form.querySelector('#pay-target-wrap');
    if (pt === 'cash') {
      pwrap.innerHTML = '<div class="input" style="display:flex;align-items:center;color:var(--muted)">현금으로 지출</div>';
    } else if (pt === 'card') {
      pwrap.innerHTML = '<select class="select" name="cardId">' + (state.cards.length ? state.cards.map(function (c) {
        return opt(c.id, c.name, false);
      }).join('') : opt('', '카드 없음', true)) + '</select>';
    } else {
      pwrap.innerHTML = '<select class="select" name="accountId">' + (state.accounts.length ? state.accounts.map(function (x) {
        return opt(x.id, x.name, false);
      }).join('') : opt('', '통장 없음', true)) + '</select>';
    }
  }

  function sheetTxn(txn) {
    var isNew = !txn;
    txn = txn || {
      date: ui.quick.date, amount: '', categoryId: state.categories[0].id,
      sub: (state.categories[0].subs || ['기타'])[0], pay: { type: 'card', cardId: state.cards[0] ? state.cards[0].id : '' }, memo: ''
    };
    var catOpts = state.categories.map(function (c) { return opt(c.id, c.name, txn.categoryId === c.id); }).join('');
    var c0 = catById(txn.categoryId);
    var subOpts = (c0.subs || ['기타']).map(function (s) { return opt(s, s, txn.sub === s); }).join('');
    var methods = [['card', '카드'], ['account', '계좌'], ['cash', '현금']];
    var mt = (txn.pay && txn.pay.type) || 'cash';
    var methodOpts = methods.map(function (m) { return opt(m[0], m[1], mt === m[0]); }).join('');
    var payOpts = '';
    if (mt === 'card') payOpts = state.cards.length ? state.cards.map(function (c) { return opt(c.id, c.name, txn.pay.cardId === c.id); }).join('') : opt('', '카드 없음', true);
    else if (mt === 'account') payOpts = state.accounts.length ? state.accounts.map(function (x) { return opt(x.id, x.name, txn.pay.accountId === x.id); }).join('') : opt('', '통장 없음', true);

    openSheet(isNew ? '변동 내역 추가' : '내역 수정',
      '<form data-form="txn" data-id="' + (txn.id || '') + '">' +
      '<div class="form-grid">' +
      '<div class="form-field"><label class="field-label">날짜</label><input class="input" type="date" name="date" value="' + esc(txn.date) + '" required></div>' +
      '<div class="form-field"><label class="field-label">금액</label>' + inp('amount', txn.amount ? Math.round(txn.amount).toLocaleString('ko-KR') : '', 'inputmode="numeric" placeholder="0" required') + '</div>' +
      '</div>' +
      '<div class="form-grid" style="margin-top:12px">' +
      '<div class="form-field"><label class="field-label">대분류</label><select class="select" name="categoryId" id="txn-cat">' + catOpts + '</select></div>' +
      '<div class="form-field"><label class="field-label">소분류</label><select class="select" name="sub" id="txn-sub">' + subOpts + '</select></div>' +
      '</div>' +
      '<label class="field-label">결제수단</label><select class="select" name="payType" id="txn-paytype">' + methodOpts + '</select>' +
      '<div id="txn-pay-wrap" style="margin-top:8px">' + (payOpts ? '<select class="select" name="payId">' + payOpts + '</select>' : '') + '</div>' +
      '<label class="field-label">메모 (선택)</label>' + inp('memo', txn.memo || '', 'maxlength="40" placeholder="예: 스타벅스, 코스트코"') +
      '<p class="form-error" data-error></p>' +
      '<button class="btn btn--primary btn--block" type="submit">저장</button>' +
      (isNew ? '' : '<button class="btn btn--danger btn--block" type="button" data-act="txn-del" data-id="' + txn.id + '">삭제</button>') +
      '</form>');
  }

  function refreshPayWrap(select) {
    var wrap = document.getElementById('txn-pay-wrap');
    if (!wrap) return;
    var t = select.value;
    if (t === 'card') wrap.innerHTML = '<select class="select" name="payId">' + (state.cards.length ? state.cards.map(function (c) { return opt(c.id, c.name, false); }).join('') : opt('', '카드 없음', true)) + '</select>';
    else if (t === 'account') wrap.innerHTML = '<select class="select" name="payId">' + (state.accounts.length ? state.accounts.map(function (x) { return opt(x.id, x.name, false); }).join('') : opt('', '통장 없음', true)) + '</select>';
    else wrap.innerHTML = '';
  }

  function sheetCard(card) {
    var isNew = !card;
    card = card || { name: '', billingDay: 25, accountId: state.accounts[0] ? state.accounts[0].id : '' };
    var dayOpts = '';
    for (var i = 1; i <= 31; i++) dayOpts += opt(i, i + '일', card.billingDay === i);
    var accOpts = state.accounts.length ? state.accounts.map(function (x) { return opt(x.id, x.name, card.accountId === x.id); }).join('') : opt('', '연결 통장 없음', true);
    openSheet(isNew ? '카드 추가' : '카드 수정',
      '<form data-form="card" data-id="' + (card.id || '') + '">' +
      '<label class="field-label">카드 이름</label>' + inp('name', card.name, 'maxlength="20" placeholder="예: 카드 A" required') +
      '<div class="form-grid" style="margin-top:12px">' +
      '<div class="form-field"><label class="field-label">결제일</label><select class="select" name="billingDay">' + dayOpts + '</select></div>' +
      '<div class="form-field"><label class="field-label">결제 통장</label><select class="select" name="accountId">' + accOpts + '</select></div>' +
      '</div>' +
      '<p class="form-error" data-error></p>' +
      '<button class="btn btn--primary btn--block" type="submit">저장</button></form>');
  }

  function sheetFavorite(fav) {
    var isNew = !fav;
    fav = fav || {
      label: '', amount: '',
      categoryId: state.categories[0].id, sub: (state.categories[0].subs || ['기타'])[0],
      pay: state.cards.length ? { type: 'card', cardId: state.cards[0].id } : { type: 'cash' }
    };
    var catOpts = state.categories.map(function (c) { return opt(c.id, c.name, fav.categoryId === c.id); }).join('');
    var fc = catById(fav.categoryId);
    var subOpts = (fc.subs || ['기타']).map(function (x) { return opt(x, x, fav.sub === x); }).join('');
    var mt = (fav.pay && fav.pay.type) || 'cash';
    var methodOpts = opt('card', '카드', mt === 'card') + opt('account', '계좌', mt === 'account') + opt('cash', '현금', mt === 'cash');
    var payOpts = '';
    if (mt === 'card') payOpts = state.cards.length ? state.cards.map(function (c) { return opt(c.id, c.name, fav.pay.cardId === c.id); }).join('') : opt('', '카드 없음', true);
    else if (mt === 'account') payOpts = state.accounts.length ? state.accounts.map(function (x) { return opt(x.id, x.name, fav.pay.accountId === x.id); }).join('') : opt('', '통장 없음', true);

    openSheet(isNew ? '즐겨찾기 추가' : '즐겨찾기 수정',
      '<form data-form="favorite" data-id="' + (fav.id || '') + '">' +
      '<label class="field-label">이름</label>' + inp('label', fav.label, 'maxlength="20" placeholder="예: 아메리카노" required') +
      '<label class="field-label">금액</label>' + inp('amount', fav.amount ? Math.round(fav.amount).toLocaleString('ko-KR') : '', 'inputmode="numeric" placeholder="0" required') +
      '<div class="form-grid" style="margin-top:12px">' +
      '<div class="form-field"><label class="field-label">대분류</label><select class="select" name="categoryId" id="fav-cat">' + catOpts + '</select></div>' +
      '<div class="form-field"><label class="field-label">소분류</label><select class="select" name="sub" id="fav-sub">' + subOpts + '</select></div>' +
      '</div>' +
      '<label class="field-label">결제수단</label><select class="select" name="payType" id="fav-paytype">' + methodOpts + '</select>' +
      '<div id="fav-pay-wrap" style="margin-top:8px">' + (payOpts ? '<select class="select" name="payId">' + payOpts + '</select>' : '') + '</div>' +
      '<p class="form-error" data-error></p>' +
      '<button class="btn btn--primary btn--block" type="submit">저장</button>' +
      (isNew ? '' : '<button class="btn btn--danger btn--block" type="button" data-act="fav-del" data-id="' + fav.id + '">삭제</button>') +
      '</form>');
  }

  function sheetCategory(cat) {
    var isNew = !cat;
    cat = cat || { name: '', budget: '', subs: ['기타'] };
    openSheet(isNew ? '카테고리 추가' : '카테고리 수정',
      '<form data-form="category" data-id="' + (cat.id || '') + '">' +
      '<label class="field-label">이름</label>' + inp('name', cat.name, 'maxlength="20" placeholder="예: 식비" required') +
      '<label class="field-label">월 예산 (원)</label>' + inp('budget', cat.budget ? Math.round(cat.budget).toLocaleString('ko-KR') : '', 'inputmode="numeric" placeholder="0"') +
      '<label class="field-label">소분류 (쉼표로 구분)</label>' + inp('subs', (cat.subs || []).join(', '), 'placeholder="장보기, 외식, 배달, 카페"') +
      '<p class="form-error" data-error></p>' +
      '<button class="btn btn--primary btn--block" type="submit">저장</button>' +
      (isNew ? '' : '<button class="btn btn--danger btn--block" type="button" data-act="cat-del" data-id="' + cat.id + '">삭제</button>') +
      '</form>');
  }

  /* ---------- 변동 입력 ---------- */
  function refreshQuick() {
    var catWrap = document.getElementById('quick-cat');
    if (catWrap) catWrap.innerHTML = quickCatChips();
    var subWrap = document.getElementById('quick-sub');
    if (subWrap) subWrap.innerHTML = quickSubChips();
    var seg = document.getElementById('q-method-seg');
    if (seg) {
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-method') === ui.quick.method);
      });
    }
    var pay = document.getElementById('q-pay-select');
    if (pay) {
      if (ui.quick.method === 'card') {
        pay.innerHTML = '<select class="select" id="q-card" aria-label="카드 선택">' + (state.cards.length ? state.cards.map(function (c) {
          return opt(c.id, c.name, c.id === ui.quick.cardId);
        }).join('') : '<option value="">카드 없음</option>') + '</select>';
      } else if (ui.quick.method === 'account') {
        pay.innerHTML = '<select class="select" id="q-account" aria-label="통장 선택">' + (state.accounts.length ? state.accounts.map(function (x) {
          return opt(x.id, x.name, x.id === ui.quick.accountId);
        }).join('') : '<option value="">통장 없음</option>') + '</select>';
      } else {
        pay.innerHTML = '<div class="input" style="display:flex;align-items:center;color:var(--muted)">현금 지출</div>';
      }
    }
    var hint = document.getElementById('q-hint');
    if (hint) hint.textContent = '';
  }

  function classify(text) {
    var t = String(text || '');
    if (!t.trim()) return null;
    var rules = [
      { k: ['스타벅스', '메가커피', '투썸', '컴포즈', '커피', '카페', '빽다방'], cat: '식비', sub: '카페' },
      { k: ['배달', '배민', '요기요', '쿠팡이츠'], cat: '식비', sub: '배달' },
      { k: ['이마트', '홈플러스', '롯데마트', '코스트코', '마트', '장보기', '컬리', '하나로'], cat: '식비', sub: '장보기' },
      { k: ['식당', '김밥', '국밥', '점심', '저녁', '외식', '분식'], cat: '식비', sub: '외식' },
      { k: ['주유', '기름', 'GS칼텍스', 'S-OIL', '에쓰오일', '주차', '택시', '카카오T', '지하철', '버스'], cat: '교통·차량' },
      { k: ['다이소', '쿠팡', '무신사', '생활용품', '쇼핑', '세제', '휴지'], cat: '생활·쇼핑' },
      { k: ['병원', '약국', '의원', '치과', '한의원'], cat: '건강·의료' },
      { k: ['영화', 'CGV', '공연', '피아노', '취미', '독서', '책'], cat: '여가·취미' },
      { k: ['경조사', '축의금', '부의금', '선물', '명절', '결혼식'], cat: '비정기·경조사' }
    ];
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i].k.length; j++) {
        if (t.indexOf(rules[i].k[j]) !== -1) {
          var cat = state.categories.filter(function (c) { return c.name === rules[i].cat; })[0];
          if (!cat) continue;
          var sub = rules[i].sub;
          if (!sub || (cat.subs || []).indexOf(sub) === -1) sub = (cat.subs || ['기타'])[0];
          return { categoryId: cat.id, sub: sub, label: cat.name + ' · ' + sub };
        }
      }
    }
    return null;
  }

  function createTxnFromQuick() {
    var amount = Math.round(num(ui.quick.amount));
    if (!(amount > 0)) { toast('금액을 입력해 주세요.'); var el = document.getElementById('q-amount'); if (el) el.focus(); return null; }
    var pay;
    if (ui.quick.method === 'card') {
      var cid = byId(state.cards, ui.quick.cardId) ? ui.quick.cardId : (state.cards[0] ? state.cards[0].id : '');
      pay = cid ? { type: 'card', cardId: cid } : { type: 'cash' };
    } else if (ui.quick.method === 'account') {
      var aid = byId(state.accounts, ui.quick.accountId) ? ui.quick.accountId : (state.accounts[0] ? state.accounts[0].id : '');
      pay = aid ? { type: 'account', accountId: aid } : { type: 'cash' };
    } else pay = { type: 'cash' };
    return {
      id: uid('tx_'), date: ui.quick.date, amount: amount,
      categoryId: ui.quick.categoryId, sub: ui.quick.sub, pay: pay,
      memo: String(ui.quick.memo || '').slice(0, 40), createdAt: new Date().toISOString()
    };
  }

  /* ---------- 백업 ---------- */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function exportJSON() {
    var name = '가계부-백업-' + ymd(new Date()) + '.json';
    download(name, JSON.stringify(state, null, 2), 'application/json;charset=utf-8');
    toast('JSON 백업을 내보냈어요.');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    var a = analyze(ui.month);
    var lines = [['구분', '날짜', '분류', '소분류', '항목', '금액', '결제수단', '메모']];
    a.rows.forEach(function (r) {
      r.dates.forEach(function (d, idx) {
        lines.push([
          KIND[r.item.kind].label, ymd(d),
          r.item.kind === 'income' ? '수입' : KIND[r.item.kind].label,
          r.item.schedule.type === 'weekly' ? '매주' : '매월',
          r.item.name + (r.days > 1 ? (' (' + (idx + 1) + '/' + r.days + ')') : ''),
          r.item.amount, payName(r.item.pay), r.item.memo || ''
        ]);
      });
    });
    a.txs.slice().sort(function (x, y) { return x.date.localeCompare(y.date); }).forEach(function (t) {
      var c = catById(t.categoryId);
      lines.push(['변동', t.date, c.name, t.sub, c.name + ' · ' + t.sub, t.amount, payName(t.pay), t.memo || '']);
    });
    var csv = '\uFEFF' + lines.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
    download('가계부-' + ui.month + '.csv', csv, 'text/csv;charset=utf-8');
    toast('CSV를 내보냈어요 · ' + a.rows.length + '개 항목');
  }

  function importText(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: 'JSON 형식이 아니에요.' }; }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items) || !Array.isArray(raw.txns)) {
      return { ok: false, error: '가계부 백업 파일이 아니에요 (items·txns 없음).' };
    }
    var next = normalize(raw);
    next.meta.welcome = false;
    state = next;
    save();
    ui.month = currentMonthKey();
    ui.quick = defaultQuick();
    render();
    return { ok: true, items: state.items.length, txns: state.txns.length };
  }

  /* ---------- 액션 ---------- */
  function doAction(act, el) {
    var id = el.getAttribute('data-id');
    if (act === 'tab') {
      ui.tab = el.getAttribute('data-tab');
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (act === 'month') {
      ui.month = shiftKey(ui.month, Number(el.getAttribute('data-delta')) || 0);
      render();
      return;
    }
    if (act === 'month-today') {
      ui.month = currentMonthKey();
      render();
      return;
    }
    if (act === 'welcome-close') {
      state.meta.welcome = false; save(); render(); return;
    }
    if (act === 'sample-clear') {
      askConfirm('빈 장부로 시작할까요?', '예시 항목·내역·즐겨찾기만 지우고, 통장·카드·카테고리 예산은 그대로 둡니다.', '빈 장부로 시작', false).then(function (ok) {
        if (!ok) return;
        state.items = [];
        state.txns = [];
        state.favorites = [];
        state.meta.sample = false;
        state.meta.welcome = false;
        save(); ui.quick = defaultQuick(); render();
        toast('빈 장부로 시작했어요.');
      });
      return;
    }
    if (act === 'sample-reset') {
      askConfirm('예시 데이터로 채울까요?', '지금 기록 중인 항목·내역은 모두 지워지고 일반화된 예시로 바뀝니다. 먼저 JSON 백업을 권해요.', '예시로 채우기').then(function (ok) {
        if (!ok) return;
        state = makeSample();
        save(); ui.month = currentMonthKey(); ui.quick = defaultQuick(); render();
        toast('예시 데이터로 채웠어요.');
      });
      return;
    }
    if (act === 'clear-all') {
      askConfirm('전체를 비울까요?', '항목·내역·통장·카드·카테고리 설정까지 모두 지워집니다. 이 작업은 되돌릴 수 없어요. 필요하면 먼저 JSON으로 백업하세요.', '전부 지우기').then(function (ok) {
        if (!ok) return;
        state = baseState();
        state.items = []; state.txns = []; state.favorites = [];
        state.accounts = []; state.cards = [];
        save(); ui.month = currentMonthKey(); ui.quick = defaultQuick(); render();
        toast('모두 비웠어요.');
      });
      return;
    }
    if (act === 'item-new') { sheetItem(null); return; }
    if (act === 'item-edit') { var it = byId(state.items, id); if (it) sheetItem(it); return; }
    if (act === 'item-del') {
      var target = byId(state.items, id);
      if (!target) return;
      askConfirm('항목을 삭제할까요?', '“' + esc(target.name) + '” 항목을 삭제합니다. 저장된 완료 표시도 함께 사라져요.', '삭제').then(function (ok) {
        if (!ok) return;
        state.items = state.items.filter(function (x) { return x.id !== id; });
        save(); closeSheet(); render(); toast('항목을 삭제했어요.');
      });
      return;
    }
    if (act === 'item-done') {
      var item = byId(state.items, id);
      if (!item) return;
      item.done = item.done || {};
      if (item.done[ui.month]) delete item.done[ui.month];
      else item.done[ui.month] = true;
      save(); render();
      return;
    }
    if (act === 'q-cat') {
      ui.quick.categoryId = id;
      var c = catById(id);
      ui.quick.sub = (c.subs || ['기타'])[0];
      ui.quick.catManual = true;
      refreshQuick();
      return;
    }
    if (act === 'q-sub') {
      ui.quick.sub = el.getAttribute('data-sub') || '기타';
      ui.quick.catManual = true;
      refreshQuick();
      return;
    }
    if (act === 'q-method') {
      ui.quick.method = el.getAttribute('data-method');
      refreshQuick();
      return;
    }
    if (act === 'q-save') {
      var tx = createTxnFromQuick();
      if (!tx) return;
      var before = { amount: ui.quick.amount, memo: ui.quick.memo, date: ui.quick.date };
      state.txns.push(tx);
      save();
      ui.quick.amount = ''; ui.quick.memo = ''; ui.quick.catManual = false;
      ui.quick.date = inPeriod(ymd(new Date()), analyze(ui.month).period) ? ymd(new Date()) : ymd(analyze(ui.month).period.start);
      render();
      toast(money(tx.amount) + ' 기록했어요.', function () {
        state.txns = state.txns.filter(function (t) { return t.id !== tx.id; });
        save(); render();
        ui.quick.amount = before.amount; ui.quick.memo = before.memo; ui.quick.date = before.date;
        render();
      });
      return;
    }
    if (act === 'fav-use') {
      var fav = state.favorites.filter(function (f) { return f.id === id; })[0];
      if (!fav) return;
      if (!(fav.amount > 0)) { toast('즐겨찾기에 금액이 없어요. 설정에서 고쳐 주세요.'); return; }
      var a = analyze(ui.month);
      var date = inPeriod(ymd(new Date()), a.period) ? ymd(new Date()) : ymd(a.period.start);
      var t = {
        id: uid('tx_'), date: date, amount: fav.amount, categoryId: fav.categoryId, sub: fav.sub,
        pay: JSON.parse(JSON.stringify(fav.pay)), memo: fav.label, createdAt: new Date().toISOString()
      };
      state.txns.push(t); save(); render();
      toast('“' + fav.label + '” ' + money(fav.amount) + ' 기록했어요.', function () {
        state.txns = state.txns.filter(function (x) { return x.id !== t.id; });
        save(); render();
      });
      return;
    }
    if (act === 'txn-edit') { var t2 = byId(state.txns, id); if (t2) sheetTxn(t2); return; }
    if (act === 'txn-del') {
      askConfirm('내역을 삭제할까요?', '이 변동 내역을 삭제합니다.', '삭제').then(function (ok) {
        if (!ok) return;
        state.txns = state.txns.filter(function (x) { return x.id !== id; });
        save(); closeSheet(); render(); toast('내역을 삭제했어요.');
      });
      return;
    }
    if (act === 'acc-add') {
      var input = document.getElementById('new-acc');
      var name = input ? input.value.trim() : '';
      if (!name) { toast('통장 이름을 입력해 주세요.'); return; }
      state.accounts.push({ id: uid('acc_'), name: name.slice(0, 20) });
      save(); render(); toast('통장을 추가했어요.');
      return;
    }
    if (act === 'acc-del') {
      var acc = byId(state.accounts, id);
      if (!acc) return;
      var usedItems = state.items.filter(function (x) { return x.pay.type === 'account' && x.pay.accountId === id; }).length;
      var usedTx = state.txns.filter(function (x) { return x.pay.type === 'account' && x.pay.accountId === id; }).length;
      var linked = state.cards.filter(function (c) { return c.accountId === id; }).length;
      askConfirm('통장을 삭제할까요?', '“' + esc(acc.name) + '”에 연결된 항목 ' + usedItems + '개, 변동 내역 ' + usedTx + '건은 <b>현금</b>으로 바뀌고, 카드 ' + linked + '개의 연결 통장은 비워집니다.', '삭제').then(function (ok) {
        if (!ok) return;
        state.items.forEach(function (x) { if (x.pay.type === 'account' && x.pay.accountId === id) x.pay = { type: 'cash' }; });
        state.txns.forEach(function (x) { if (x.pay.type === 'account' && x.pay.accountId === id) x.pay = { type: 'cash' }; });
        state.cards.forEach(function (c) { if (c.accountId === id) c.accountId = ''; });
        state.accounts = state.accounts.filter(function (x) { return x.id !== id; });
        save(); render(); toast('통장을 삭제했어요.');
      });
      return;
    }
    if (act === 'card-new') { sheetCard(null); return; }
    if (act === 'card-edit') { var cd = byId(state.cards, id); if (cd) sheetCard(cd); return; }
    if (act === 'card-del') { deleteCard(id); return; }
    if (act === 'fav-new') { sheetFavorite(null); return; }
    if (act === 'fav-edit') { var fv = byId(state.favorites, id); if (fv) sheetFavorite(fv); return; }
    if (act === 'fav-del') {
      var fv2 = byId(state.favorites, id);
      if (!fv2) return;
      askConfirm('즐겨찾기를 삭제할까요?', '“' + esc(fv2.label) + '” 즐겨찾기를 삭제합니다. 이미 기록된 내역은 그대로 남아요.', '삭제').then(function (ok) {
        if (!ok) return;
        state.favorites = state.favorites.filter(function (x) { return x.id !== id; });
        save(); closeSheet(); render(); toast('즐겨찾기를 삭제했어요.');
      });
      return;
    }
    if (act === 'cat-new') { sheetCategory(null); return; }
    if (act === 'cat-edit') { var ct = byId(state.categories, id); if (ct) sheetCategory(ct); return; }
    if (act === 'cat-del') { deleteCategory(id); return; }
    if (act === 'export-json') { exportJSON(); return; }
    if (act === 'export-csv') { exportCSV(); return; }
    if (act === 'import-json') { document.getElementById('import-file').click(); return; }
    if (act === 'sheet-close') { closeSheet(); return; }
    if (act === 'toast-undo') {
      if (ui.undo) { var fn = ui.undo; ui.undo = null; fn(); }
      document.getElementById('toast').hidden = true;
      return;
    }
  }

  function deleteCard(id) {
    var c = byId(state.cards, id);
    if (!c) return;
    var usedItems = state.items.filter(function (x) { return x.pay.type === 'card' && x.pay.cardId === id; }).length;
    var usedTx = state.txns.filter(function (x) { return x.pay.type === 'card' && x.pay.cardId === id; }).length;
    askConfirm('카드를 삭제할까요?', '“' + esc(c.name) + '”에 연결된 항목 ' + usedItems + '개와 변동 내역 ' + usedTx + '건은 <b>현금</b>으로 바뀝니다.', '삭제').then(function (ok) {
      if (!ok) return;
      state.items.forEach(function (x) { if (x.pay.type === 'card' && x.pay.cardId === id) x.pay = { type: 'cash' }; });
      state.txns.forEach(function (x) { if (x.pay.type === 'card' && x.pay.cardId === id) x.pay = { type: 'cash' }; });
      state.favorites.forEach(function (x) { if (x.pay.type === 'card' && x.pay.cardId === id) x.pay = { type: 'cash' }; });
      state.cards = state.cards.filter(function (x) { return x.id !== id; });
      save(); closeSheet(); render(); toast('카드를 삭제했어요.');
    });
  }

  function deleteCategory(id) {
    var c = byId(state.categories, id);
    if (!c) return;
    if (state.categories.length <= 1) { toast('카테고리는 최소 1개가 필요해요.'); return; }
    var used = state.txns.filter(function (x) { return x.categoryId === id; }).length;
    askConfirm('카테고리를 삭제할까요?', '“' + esc(c.name) + '” 카테고리의 내역 ' + used + '건은 다른 카테고리로 옮겨집니다.', '삭제').then(function (ok) {
      if (!ok) return;
      var fallback = state.categories.filter(function (x) { return x.id !== id; })[0];
      state.txns.forEach(function (x) {
        if (x.categoryId === id) { x.categoryId = fallback.id; x.sub = (fallback.subs || ['기타'])[0]; }
      });
      state.favorites.forEach(function (x) { if (x.categoryId === id) { x.categoryId = fallback.id; x.sub = (fallback.subs || ['기타'])[0]; } });
      state.categories = state.categories.filter(function (x) { return x.id !== id; });
      save(); closeSheet(); render(); toast('카테고리를 삭제했어요.');
    });
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.disabled) return;
    doAction(el.getAttribute('data-act'), el);
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'set-start') {
      var v = clamp(Math.round(num(t.value)) || 1, 1, 28);
      state.settings.monthStartDay = v;
      save();
      ui.month = currentMonthKey();
      ui.quick = defaultQuick();
      render();
      toast('월 시작일을 ' + v + '일로 바꿨어요.');
      return;
    }
    if (t.id === 'q-date') { ui.quick.date = t.value; return; }
    if (t.id === 'q-card') { ui.quick.cardId = t.value; return; }
    if (t.id === 'q-account') { ui.quick.accountId = t.value; return; }
    if (t.id === 'txn-cat') {
      var cat = catById(t.value);
      var sub = document.getElementById('txn-sub');
      if (sub) sub.innerHTML = (cat.subs || ['기타']).map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      }).join('');
      return;
    }
    if (t.id === 'txn-paytype') { refreshPayWrap(t); return; }
    if (t.id === 'fav-cat') {
      var fcat = catById(t.value);
      var fsub = document.getElementById('fav-sub');
      if (fsub) fsub.innerHTML = (fcat.subs || ['기타']).map(function (x) {
        return '<option value="' + esc(x) + '">' + esc(x) + '</option>';
      }).join('');
      return;
    }
    if (t.id === 'fav-paytype') {
      var fwrap = document.getElementById('fav-pay-wrap');
      var fmt = t.value;
      if (!fwrap) return;
      if (fmt === 'card') fwrap.innerHTML = '<select class="select" name="payId">' + (state.cards.length ? state.cards.map(function (c) { return opt(c.id, c.name, false); }).join('') : opt('', '카드 없음', true)) + '</select>';
      else if (fmt === 'account') fwrap.innerHTML = '<select class="select" name="payId">' + (state.accounts.length ? state.accounts.map(function (x) { return opt(x.id, x.name, false); }).join('') : opt('', '통장 없음', true)) + '</select>';
      else fwrap.innerHTML = '';
      return;
    }
    if (t.name === 'schedType' || t.name === 'payType') {
      var form = t.closest('form');
      if (form) syncItemForm(form);
      return;
    }
    if (t.id === 'import-file') {
      var f = t.files && t.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        askConfirm('백업을 불러올까요?', '지금 기기의 기록을 백업 파일 내용으로 덮어씁니다. 먼저 현재 데이터를 JSON으로 내보내 두면 안전해요.', '불러오기', false).then(function (ok) {
          if (!ok) { t.value = ''; return; }
          var r = importText(String(reader.result || ''));
          if (!r.ok) { toast(r.error); return; }
          toast('불러왔어요 · 항목 ' + r.items + '개 · 내역 ' + r.txns + '건');
        });
        t.value = '';
      };
      reader.readAsText(f, 'utf-8');
      return;
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'q-amount') {
      var digits = t.value.replace(/[^\d]/g, '').slice(0, 12);
      var n = digits ? Number(digits) : 0;
      ui.quick.amount = digits;
      t.value = digits ? n.toLocaleString('ko-KR') : '';
      try { t.setSelectionRange(t.value.length, t.value.length); } catch (err) {}
      return;
    }
    if (t.id === 'q-memo') {
      ui.quick.memo = t.value;
      var hit = classify(t.value);
      var hint = document.getElementById('q-hint');
      if (hit && !ui.quick.catManual) {
        ui.quick.categoryId = hit.categoryId;
        ui.quick.sub = hit.sub;
        refreshQuick();
        if (hint) hint.textContent = '자동 분류 · ' + hit.label;
      } else if (hint) {
        hint.textContent = hit ? '자동 분류 후보 · ' + hit.label : '';
      }
      return;
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.matches('form[data-form]')) return;
    e.preventDefault();
    var type = form.getAttribute('data-form');
    var id = form.getAttribute('data-id');
    var err = form.querySelector('[data-error]');
    function fail(msg) { if (err) err.textContent = msg; }

    if (type === 'item') {
      var name = String(form.elements.name.value || '').trim();
      var amount = Math.round(num(form.amount.value));
      if (!name) return fail('항목명을 입력해 주세요.');
      if (!(amount > 0)) return fail('금액을 입력해 주세요.');
      var schedType = form.schedType.value;
      var schedule = schedType === 'weekly'
        ? { type: 'weekly', weekday: Number(form.weekday.value) }
        : { type: 'monthly', day: Number(form.day.value) };
      var pay;
      if (form.payType.value === 'card') {
        if (!state.cards.length) return fail('등록된 카드가 없어요. 설정에서 카드를 추가하거나 현금을 골라 주세요.');
        pay = { type: 'card', cardId: form.cardId ? form.cardId.value : '' };
      } else if (form.payType.value === 'cash') pay = { type: 'cash' };
      else {
        if (!state.accounts.length) return fail('등록된 통장이 없어요. 설정에서 통장을 추가하거나 현금을 골라 주세요.');
        pay = { type: 'account', accountId: form.accountId ? form.accountId.value : '' };
      }
      var memo = String(form.memo.value || '').slice(0, 80);
      if (id) {
        var it = byId(state.items, id);
        if (it) {
          it.name = name.slice(0, 40); it.kind = form.kind.value; it.amount = amount;
          it.schedule = schedule; it.pay = pay; it.memo = memo;
          save(); closeSheet(); render(); toast('항목을 저장했어요.');
        }
      } else {
        state.items.push({
          id: uid('it_'), name: name.slice(0, 40), kind: form.kind.value, amount: amount,
          schedule: schedule, pay: pay, memo: memo,
          done: {}
        });
        save(); closeSheet(); render(); toast('항목을 추가했어요.');
      }
      return;
    }

    if (type === 'txn') {
      var date = form.date.value;
      var amt = Math.round(num(form.amount.value));
      if (!parseYmd(date)) return fail('날짜를 골라 주세요.');
      if (!(amt > 0)) return fail('금액을 입력해 주세요.');
      var payType = form.payType.value;
      if (payType === 'card' && !state.cards.length) return fail('등록된 카드가 없어요.');
      if (payType === 'account' && !state.accounts.length) return fail('등록된 통장이 없어요.');
      var pay2 = payType === 'card'
        ? { type: 'card', cardId: form.payId ? form.payId.value : '' }
        : payType === 'account'
          ? { type: 'account', accountId: form.payId ? form.payId.value : '' }
          : { type: 'cash' };
      var txn = byId(state.txns, id);
      if (txn) {
        txn.date = date; txn.amount = amt; txn.categoryId = form.categoryId.value;
        txn.sub = form.sub.value; txn.pay = pay2; txn.memo = String(form.memo.value || '').slice(0, 40);
      } else {
        state.txns.push({
          id: uid('tx_'), date: date, amount: amt, categoryId: form.categoryId.value,
          sub: form.sub.value, pay: pay2, memo: String(form.memo.value || '').slice(0, 40),
          createdAt: new Date().toISOString()
        });
      }
      save(); closeSheet(); render(); toast('저장했어요 · ' + money(amt));
      return;
    }

    if (type === 'favorite') {
      var label = String(form.elements.label.value || '').trim();
      var famt = Math.round(num(form.amount.value));
      if (!label) return fail('이름을 입력해 주세요.');
      if (!(famt > 0)) return fail('금액을 입력해 주세요.');
      var fpt = form.payType.value;
      if (fpt === 'card' && !state.cards.length) return fail('등록된 카드가 없어요.');
      if (fpt === 'account' && !state.accounts.length) return fail('등록된 통장이 없어요.');
      var fpay = fpt === 'card'
        ? { type: 'card', cardId: form.payId ? form.payId.value : '' }
        : fpt === 'account'
          ? { type: 'account', accountId: form.payId ? form.payId.value : '' }
          : { type: 'cash' };
      if (id) {
        var fv3 = byId(state.favorites, id);
        if (fv3) {
          fv3.label = label.slice(0, 20); fv3.amount = famt; fv3.categoryId = form.categoryId.value;
          fv3.sub = form.sub.value; fv3.pay = fpay;
        }
      } else {
        state.favorites.push({
          id: uid('fav_'), label: label.slice(0, 20), amount: famt,
          categoryId: form.categoryId.value, sub: form.sub.value, pay: fpay
        });
      }
      save(); closeSheet(); render(); toast('즐겨찾기를 저장했어요.');
      return;
    }

    if (type === 'card') {
      var cname = String(form.elements.name.value || '').trim();
      if (!cname) return fail('카드 이름을 입력해 주세요.');
      var bd = clamp(Number(form.billingDay.value) || 1, 1, 31);
      var accId = form.accountId.value || '';
      if (id) {
        var c = byId(state.cards, id);
        if (c) { c.name = cname.slice(0, 20); c.billingDay = bd; c.accountId = accId; }
      } else {
        state.cards.push({ id: uid('card_'), name: cname.slice(0, 20), billingDay: bd, accountId: accId });
      }
      save(); closeSheet(); render(); toast('카드를 저장했어요.');
      return;
    }

    if (type === 'category') {
      var cname2 = String(form.elements.name.value || '').trim();
      if (!cname2) return fail('이름을 입력해 주세요.');
      var budget = Math.max(0, Math.round(num(form.budget.value)));
      var subs = String(form.subs.value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!subs.length) subs = ['기타'];
      if (id) {
        var cat = byId(state.categories, id);
        if (cat) { cat.name = cname2.slice(0, 20); cat.budget = budget; cat.subs = subs.slice(0, 10); }
      } else {
        state.categories.push({ id: uid('cat_'), name: cname2.slice(0, 20), budget: budget, subs: subs.slice(0, 10) });
      }
      save(); closeSheet(); render(); toast('카테고리를 저장했어요.');
      return;
    }
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-confirm]');
    if (!b) return;
    var yes = b.getAttribute('data-confirm') === 'yes';
    var resolve = ui.confirmResolve;
    ui.confirmResolve = null;
    closeSheet();
    if (resolve) resolve(yes);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.sheetOpen) closeSheet();
    // 빠른 입력: 금액·메모에서 엔터를 누르면 바로 기록
    if (e.key === 'Enter' && !ui.sheetOpen && (e.target.id === 'q-amount' || e.target.id === 'q-memo')) {
      e.preventDefault();
      var saveBtn = document.querySelector('[data-act="q-save"]');
      if (saveBtn) doAction('q-save', saveBtn);
    }
  });

  /* ---------- 시작 ---------- */
  render();

  // 오프라인 실행: http(s)로 열렸을 때만 서비스 워커를 등록합니다.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 등록 실패해도 앱은 그대로 동작 */ });
    });
  }

  /* 테스트·디버그용 최소 API (화면에는 영향 없음) */
  window.__ledger = {
    version: APP_VERSION,
    storeKey: STORE_KEY,
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    analyze: function (key) {
      var a = analyze(key || ui.month);
      return JSON.parse(JSON.stringify(a));
    },
    getMonth: function () { return ui.month; },
    setMonth: function (k) { ui.month = k; render(); },
    exportJSON: function () { return JSON.stringify(state, null, 2); },
    importJSON: function (text) { return importText(text); },
    resetSample: function () { state = makeSample(); save(); ui.month = currentMonthKey(); ui.quick = defaultQuick(); render(); return true; },
    clearAll: function () { state = baseState(); state.items = []; state.txns = []; state.favorites = []; state.accounts = []; state.cards = []; save(); ui.month = currentMonthKey(); render(); return true; },
    setState: function (raw) { state = normalize(raw); save(); ui.month = currentMonthKey(); ui.quick = defaultQuick(); render(); return true; }
  };
})();
