/* ===== Notion CLI Reference - docs.js ===== */

(function () {
  'use strict';

  // ---- DOM Ready ----
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    setupSidebarCollapse();
    setupSmoothScroll();
    setupCopyButtons();
    setupMobileMenu();
    setupSidebarSearch();
    setupIntersectionObserver();
  }

  /* ---------- 1. Collapsible sidebar groups ---------- */
  function setupSidebarCollapse() {
    var headers = document.querySelectorAll('.sidebar-group-header');
    headers.forEach(function (header) {
      header.addEventListener('click', function () {
        var group = header.closest('.sidebar-group');
        group.classList.toggle('collapsed');
      });
    });
  }

  /* ---------- 2. Smooth scroll on sidebar link click ---------- */
  function setupSmoothScroll() {
    var links = document.querySelectorAll('.sidebar-group-items a');
    links.forEach(function (link) {
      link.addEventListener('click', function (e) {
        var href = link.getAttribute('href');
        if (!href || href.charAt(0) !== '#') return;

        e.preventDefault();
        var target = document.getElementById(href.substring(1));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Update URL hash without jumping
          history.pushState(null, '', href);
        }

        // Close mobile sidebar
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
      });
    });
  }

  /* ---------- 3. Copy button ---------- */
  function setupCopyButtons() {
    var buttons = document.querySelectorAll('.copy-btn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var block = btn.closest('.code-block');
        var pre = block ? block.querySelector('pre') : null;
        if (!pre) return;

        var text = pre.textContent;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        }).catch(function () {
          // Fallback
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function () {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        });
      });
    });
  }

  /* ---------- 4. Mobile hamburger ---------- */
  function setupMobileMenu() {
    var hamburger = document.querySelector('.hamburger');
    var sidebar = document.querySelector('.sidebar');
    var overlay = document.querySelector('.sidebar-overlay');

    if (!hamburger || !sidebar) return;

    hamburger.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      if (overlay) overlay.classList.toggle('active');
    });

    if (overlay) {
      overlay.addEventListener('click', function () {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });
    }
  }

  /* ---------- 5. Sidebar search filter ---------- */
  function setupSidebarSearch() {
    var input = document.querySelector('.sidebar-search input');
    if (!input) return;

    input.addEventListener('input', function () {
      var query = input.value.toLowerCase().trim();
      var groups = document.querySelectorAll('.sidebar-group');

      groups.forEach(function (group) {
        var items = group.querySelectorAll('.sidebar-group-items a');
        var anyVisible = false;

        items.forEach(function (item) {
          var text = item.textContent.toLowerCase();
          if (!query || text.indexOf(query) !== -1) {
            item.style.display = '';
            anyVisible = true;
          } else {
            item.style.display = 'none';
          }
        });

        group.style.display = anyVisible || !query ? '' : 'none';

        // Auto-expand groups that have matches
        if (query && anyVisible) {
          group.classList.remove('collapsed');
        }
      });
    });
  }

  /* ---------- 6. Intersection Observer for active sidebar link ---------- */
  function setupIntersectionObserver() {
    var sections = document.querySelectorAll('.command-section');
    var links = document.querySelectorAll('.sidebar-group-items a');

    if (!sections.length || !links.length) return;

    var linkMap = {};
    links.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href && href.charAt(0) === '#') {
        linkMap[href.substring(1)] = link;
      }
    });

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          // Remove all active
          links.forEach(function (l) { l.classList.remove('active'); });
          // Set active
          var id = entry.target.getAttribute('id');
          if (id && linkMap[id]) {
            linkMap[id].classList.add('active');
          }
        }
      });
    }, {
      rootMargin: '-60px 0px -70% 0px',
      threshold: 0
    });

    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

})();
