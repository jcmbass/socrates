(function (global) {
  'use strict';

  var STORAGE_KEY = 'socrates.state.v1';
  var SCREENS = [
    'splash',
    'login',
    'onboard-paso-1-grados',
    'onboard-paso-2-materias',
    'onboard-paso-3-temario',
    'home',
    'estudios',
    'tema-tutor-socratico'
  ];

  var memoryStore = null;

  function canUseStorage() {
    if (!global.localStorage) return false;
    try {
      var testKey = '__socrates_storage_test__';
      global.localStorage.setItem(testKey, '1');
      global.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  function storageGet() {
    try {
      if (canUseStorage()) {
        return global.localStorage.getItem(STORAGE_KEY);
      }
    } catch (e) {}
    return memoryStore;
  }

  function storageSet(value) {
    try {
      if (canUseStorage()) {
        global.localStorage.setItem(STORAGE_KEY, value);
        return;
      }
    } catch (e) {}
    memoryStore = value;
  }

  function isPlainObject(obj) {
    return Object.prototype.toString.call(obj) === '[object Object]';
  }

  function deepMerge(target, source) {
    if (source == null) return target;
    if (Array.isArray(source)) {
      return source.slice();
    }
    if (isPlainObject(source)) {
      var result = isPlainObject(target) ? target : {};
      for (var key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        result[key] = deepMerge(result[key], source[key]);
      }
      return result;
    }
    return source;
  }

  function buildSeed() {
    return {
      user: { name: 'Estudiante', avatar: '🧑', onboarded: false },
      onboard: {
        grade: { world: 'primaria', id: 'g2', label: '2° Segundo Grado' },
        bachiYear: null,
        subjects: ['mat', 'cien', 'soc', 'len', 'qui']
      },
      subjects: [
        {
          id: 'mat',
          name: 'Matemáticas',
          icon: 'assets/math.png',
          status: 'configured',
          topicCount: 12,
          currentTopic: 'Ángulos'
        },
        {
          id: 'cien',
          name: 'Ciencias Naturales',
          icon: 'assets/science.png',
          status: 'configuring',
          topicCount: 0,
          currentTopic: null
        },
        {
          id: 'soc',
          name: 'Estudios Sociales',
          icon: 'assets/earth.png',
          status: 'empty',
          topicCount: 0,
          currentTopic: null
        },
        {
          id: 'len',
          name: 'Lenguaje y Lit.',
          icon: 'assets/literature_icon.png',
          status: 'empty',
          topicCount: 0,
          currentTopic: null
        },
        {
          id: 'qui',
          name: 'Química 1',
          icon: 'assets/lab_icon.png',
          status: 'configured',
          topicCount: 9,
          currentTopic: 'Termoquímica'
        }
      ],
      xp: 320,
      currentSubjectId: 'qui'
    };
  }

  var S = {
    state: null,

    seed: function () {
      if (!S.state) {
        S.state = buildSeed();
      }
      return S.state;
    },

    load: function () {
      var seed = buildSeed();
      var stored = null;
      try {
        var raw = storageGet();
        if (raw) {
          stored = JSON.parse(raw);
        }
      } catch (e) {
        stored = null;
      }

      var merged = deepMerge(seed, stored);
      S.state = merged;
      S.save();
      return S.state;
    },

    save: function () {
      if (!S.state) return;
      try {
        storageSet(JSON.stringify(S.state));
      } catch (e) {
        // Silently fail if storage is unavailable; memoryStore fallback keeps the app running.
      }
    },

    nav: {
      go: function (screen) {
        if (SCREENS.indexOf(screen) === -1) {
          throw new Error('Unknown screen: ' + screen);
        }
        if (global.location && global.location.href !== undefined) {
          global.location.href = screen + '.html';
        }
      }
    },

    getSubject: function (id) {
      if (!S.state || !S.state.subjects) return undefined;
      for (var i = 0; i < S.state.subjects.length; i++) {
        if (S.state.subjects[i].id === id) {
          return S.state.subjects[i];
        }
      }
      return undefined;
    },

    setCurrentSubject: function (id) {
      S.state.currentSubjectId = id;
      S.save();
    },

    addXP: function (n) {
      S.state.xp += n;
      S.save();
    }
  };

  global.S = S;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
