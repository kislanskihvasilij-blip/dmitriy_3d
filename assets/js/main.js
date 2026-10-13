/* BREEZE 3D — интерфейс: вкладки, консоль, шаблоны заявки, появление (vanilla JS) */
(() => {
  'use strict';

  const CONTACTS = Object.freeze({
    phone: '+79182898956',
    phoneLabel: '+7 918 289-89-56',
    maxWeb: 'https://web.max.ru/',
    // Ссылка-приглашение из MAX (Профиль → «Пригласить друзей»), например 'https://max.ru/u/abc123'.
    maxInvite: '',
  });

  // Этапы реверс-инжиниринга: [тип строки, текст]
  const STEPS = Object.freeze([
    { file: '01-obrazec.log', lines: [
      ['comment', '# шаг 1 — образец'],
      ['arrow', 'присылаете фото детали или передаёте образец'],
      ['arrow', 'подойдут даже обломки или изношенная деталь'],
      ['arrow', 'рассказываете, где и как она работает'],
      ['ok', 'понимаю задачу и нагрузку на деталь'],
    ] },
    { file: '02-obmery.log', lines: [
      ['comment', '# шаг 2 — обмеры'],
      ['arrow', 'снимаю размеры с образца'],
      ['arrow', 'фиксирую посадочные места, отверстия и резьбы'],
      ['arrow', 'учитываю износ и восстанавливаю исходную геометрию'],
      ['ok', 'размеры собраны'],
    ] },
    { file: '03-model.log', lines: [
      ['comment', '# шаг 3 — 3D-модель'],
      ['arrow', 'строю точную 3D-модель детали'],
      ['arrow', 'при необходимости усиливаю слабые места'],
      ['arrow', 'согласовываю модель с вами'],
      ['ok', 'модель готова к печати'],
    ] },
    { file: '04-proba.log', lines: [
      ['comment', '# шаг 4 — пробная печать'],
      ['arrow', 'печатаю тестовый образец'],
      ['arrow', 'проверяем посадку на месте'],
      ['arrow', 'вношу правки в модель, если нужно'],
      ['ok', 'размеры подтверждены'],
    ] },
    { file: '05-detal.log', lines: [
      ['comment', '# шаг 5 — готовая деталь'],
      ['arrow', 'печатаю финальную деталь из подходящего материала'],
      ['arrow', 'передаю деталь — и файл модели по запросу'],
      ['ok', 'задача решена'],
    ] },
  ]);

  // Шаблоны заявки: [поле, значение, это подсказка?]
  const TEMPLATES = Object.freeze({
    reverse: [
      ['Задача', 'восстановить деталь', false],
      ['Что за деталь', 'например, шестерня привода', true],
      ['Фото', 'с нескольких сторон, рядом линейка', true],
      ['Образец', 'есть / только обломки', true],
      ['Условия работы', 'нагрузка, температура, вода', true],
      ['Количество', 'сколько штук', true],
      ['Срок', 'к какой дате нужно', true],
    ],
    model: [
      ['Задача', '3D-модель', false],
      ['Исходные данные', 'чертёж / эскиз / фото / описание', true],
      ['Назначение', 'печать / прототип / производство', true],
      ['Ключевые размеры', 'если известны', true],
      ['Срок', 'к какой дате нужно', true],
    ],
    print: [
      ['Задача', '3D-печать', false],
      ['Файл модели', 'прикреплю (STL / STEP / OBJ)', true],
      ['Размер детали', 'примерно, в мм', true],
      ['Количество', 'сколько штук', true],
      ['Цвет и материал', 'пожелания, если есть', true],
      ['Срок', 'к какой дате нужно', true],
    ],
  });

  const TOAST_DURATION_MS = 4200;
  const REVEAL_DURATION_MS = 1100;
  const STEP_AUTOPLAY_MS = 5500;
  const LINE_SYMBOL = Object.freeze({ comment: '', arrow: '→', ok: '✓' });

  const root = document.documentElement;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const debounce = (fn, wait) => {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  root.classList.add('js');

  /* ---------- Тост и копирование ---------- */
  const toastEl = document.querySelector('[data-toast]');
  let toastTimer = 0;

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), TOAST_DURATION_MS);
  }

  // Синхронное копирование: успевает до перехода по ссылке, пока документ в фокусе
  function copyTextSync(text) {
    const previouslyFocused = document.activeElement;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length); // iOS Safari игнорирует select() у readonly-поля
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      console.warn('Копирование через execCommand недоступно:', error);
    }
    area.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    return copied;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        console.warn('Clipboard API отказал, пробую запасной способ:', error);
      }
    }
    return copyTextSync(text);
  }

  /* ---------- MAX: публичных ссылок по номеру нет — копируем номер ---------- */
  function initMaxLinks() {
    const links = $$('[data-max]');
    if (CONTACTS.maxInvite) {
      links.forEach((link) => { link.href = CONTACTS.maxInvite; });
      return;
    }
    links.forEach((link) => {
      link.href = CONTACTS.maxWeb;
      link.addEventListener('click', () => {
        const copied = copyTextSync(CONTACTS.phone);
        showToast(copied
          ? `Номер ${CONTACTS.phoneLabel} скопирован — вставьте его в поиск MAX`
          : `Найдите в MAX номер ${CONTACTS.phoneLabel}`);
      });
    });
  }

  function initCopyButtons() {
    $$('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        const value = button.dataset.copy;
        const copied = await copyText(value);
        showToast(copied ? `Скопировано: ${value}` : `Не удалось скопировать: ${value}`);
      });
    });
  }

  /* ---------- Вступление и появление при скролле ---------- */
  function initIntro() {
    $$('[data-intro]').forEach((node) => node.style.setProperty('--i', node.dataset.intro));
    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    const timeout = new Promise((resolve) => setTimeout(resolve, 1200));
    // Без rAF: в неотрисованной вкладке кадры замирают; offsetHeight фиксирует начальные стили
    Promise.race([fontsReady, timeout]).then(() => {
      void root.offsetHeight;
      root.classList.add('is-loaded');
    });
  }

  function initReveal() {
    $$('[data-stagger]').forEach((group) => {
      $$(':scope > [data-reveal]', group).forEach((child, index) => {
        child.style.setProperty('--d', `${(index * 0.1).toFixed(2)}s`);
      });
    });
    const items = $$('[data-reveal], [data-section]');
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      items.forEach((node) => node.classList.add('is-in'));
      return;
    }
    // После появления снимаем data-reveal, чтобы hover-эффекты элементов работали без задержек
    const settle = (node) => {
      if (!node.hasAttribute('data-reveal')) return;
      const delaySeconds = parseFloat(node.style.getPropertyValue('--d')) || 0;
      setTimeout(() => node.removeAttribute('data-reveal'), REVEAL_DURATION_MS + delaySeconds * 1000);
    };
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        settle(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    items.forEach((node) => observer.observe(node));
  }

  /* ---------- Вкладки: индикатор + клавиатура ---------- */
  function setupTabs(tablist, onSelect) {
    const tabs = $$('[role="tab"]', tablist);
    const indicator = tablist.querySelector('.steps__indicator');

    function moveIndicator(tab) {
      if (!indicator) return;
      indicator.style.setProperty('--x', `${tab.offsetLeft}px`);
      indicator.style.setProperty('--w', `${tab.offsetWidth}px`);
    }

    // Прокручиваем только сам ряд вкладок по горизонтали — страница не дёргается
    function revealTab(tab) {
      if (tablist.scrollWidth <= tablist.clientWidth) return;
      tablist.scrollTo({
        left: tab.offsetLeft - (tablist.clientWidth - tab.offsetWidth) / 2,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }

    function select(index, { focus = false, user = false } = {}) {
      tabs.forEach((tab, i) => {
        const isActive = i === index;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      });
      const activeTab = tabs[index];
      moveIndicator(activeTab);
      revealTab(activeTab);
      if (focus) activeTab.focus();
      onSelect(index, activeTab, user);
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index, { user: true }));
      tab.addEventListener('keydown', (event) => {
        const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
        if (!(event.key in keys)) return;
        event.preventDefault();
        select((keys[event.key] + tabs.length) % tabs.length, { focus: true, user: true });
      });
    });
    window.addEventListener('resize', debounce(() => {
      moveIndicator(tabs.find((tab) => tab.classList.contains('is-active')) || tabs[0]);
    }, 150));
    return { select, count: tabs.length };
  }

  /* ---------- Этапы реверса: «печатающаяся» консоль + автопрокрутка ---------- */
  function renderStep(index) {
    const step = STEPS[index];
    const list = document.querySelector('[data-step-lines]');
    document.querySelector('[data-step-file]').textContent = step.file;
    document.querySelector('[data-step-num]').textContent = String(index + 1);
    const items = step.lines.map(([kind, text], n) => {
      const item = el('li');
      item.style.setProperty('--n', n);
      const symbol = LINE_SYMBOL[kind];
      if (symbol) item.appendChild(el('span', `ln-${kind}`, symbol));
      item.appendChild(el('span', kind === 'comment' ? 'ln-comment' : '', text));
      return item;
    });
    list.replaceChildren(...items);
  }

  function initSteps() {
    const tablist = document.querySelector('[data-tabs="steps"]');
    if (!tablist) return;
    let current = 0;
    let autoplayTimer = 0;
    let userTookOver = false;

    const tabs = setupTabs(tablist, (index, _tab, user) => {
      current = index;
      renderStep(index);
      if (user) {
        userTookOver = true;
        clearInterval(autoplayTimer);
      }
    });
    tabs.select(0);

    if (prefersReducedMotion || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(([entry]) => {
      clearInterval(autoplayTimer);
      if (!entry.isIntersecting || userTookOver) return;
      autoplayTimer = setInterval(() => tabs.select((current + 1) % tabs.count), STEP_AUTOPLAY_MS);
    }, { threshold: 0.4 }).observe(tablist.closest('.steps'));
  }

  /* ---------- Шаблоны заявки ---------- */
  const templateToText = (rows) => [
    'Заявка — BREEZE 3D',
    ...rows.map(([key, value, isHint]) => `${key}: ${isHint ? `[${value}]` : value}`),
  ].join('\n');

  function renderTemplate(name) {
    const body = document.querySelector('[data-template-body]');
    const lines = TEMPLATES[name].map(([key, value, isHint], n) => {
      const line = el('span');
      line.style.setProperty('--n', n);
      line.append(el('span', 'tpl-key', `${key}:`), ' ', el('span', isHint ? 'tpl-hint' : '', isHint ? `[${value}]` : value));
      return line;
    });
    body.replaceChildren(...lines);
  }

  function initTemplates() {
    const tablist = document.querySelector('[data-tabs="templates"]');
    if (!tablist) return;
    const names = $$('[data-template]', tablist).map((tab) => tab.dataset.template);
    let currentName = names[0];
    setupTabs(tablist, (index) => {
      currentName = names[index];
      renderTemplate(currentName);
    }).select(0);

    document.querySelector('[data-copy-template]').addEventListener('click', async () => {
      const copied = await copyText(templateToText(TEMPLATES[currentName]));
      showToast(copied ? 'Шаблон скопирован — вставьте его в MAX или Telegram' : 'Не удалось скопировать шаблон');
    });
  }

  /* ---------- Лента деталей: дублируем для бесшовной петли ---------- */
  function initMarquee() {
    const track = document.querySelector('[data-marquee]');
    if (!track) return;
    const originals = Array.from(track.children).map((node) => node.cloneNode(true));
    const build = () => {
      track.replaceChildren(...originals.map((node) => node.cloneNode(true)));
      const viewportWidth = track.parentElement.offsetWidth;
      for (let guard = 0; track.scrollWidth < viewportWidth && guard < 20; guard += 1) {
        originals.forEach((node) => track.appendChild(node.cloneNode(true)));
      }
      Array.from(track.children).forEach((node) => {
        const clone = node.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      });
    };
    build();
    if (document.fonts) document.fonts.ready.then(build);
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', debounce(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      build();
    }, 250));
  }

  /* ---------- Навигация, пауза анимаций, мобильный док ---------- */
  function initNav() {
    const nav = document.querySelector('[data-nav]');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const links = $$('.nav__links a');
    const linkById = new Map(links.map((link) => [link.getAttribute('href').slice(1), link]));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => link.classList.toggle('is-active', link === linkById.get(entry.target.id)));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('.hero, [data-section]').forEach((section) => observer.observe(section));
  }

  function initOffscreenPause() {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('is-offscreen', !entry.isIntersecting));
    }, { rootMargin: '120px 0px' });
    $$('.hero, .section').forEach((section) => observer.observe(section));
  }

  function initDock() {
    const dock = document.querySelector('[data-dock]');
    const hero = document.querySelector('.hero');
    const contact = document.getElementById('contact');
    if (!dock || !hero || !contact) return;
    let heroVisible = true;
    let contactVisible = false;
    const sync = () => dock.classList.toggle('is-visible', !heroVisible && !contactVisible);
    new IntersectionObserver(([entry]) => {
      heroVisible = entry.intersectionRatio > 0.3;
      sync();
    }, { threshold: [0, 0.3, 1] }).observe(hero);
    new IntersectionObserver(([entry]) => {
      contactVisible = entry.isIntersecting;
      sync();
    }, { threshold: 0.2 }).observe(contact);
  }

  initIntro();
  initReveal();
  initSteps();
  initTemplates();
  initMarquee();
  initNav();
  initOffscreenPause();
  initDock();
  initMaxLinks();
  initCopyButtons();
})();
