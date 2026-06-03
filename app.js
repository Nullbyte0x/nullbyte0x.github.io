(function () {
  const routeSegmentPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const runtimeConfig = buildRuntimeConfig(window.NullbyteBlogConfig || {});
  const rootTitle = runtimeConfig.site.title;
  const siteSettings = runtimeConfig.site;
  const profileSettings = runtimeConfig.profile;
  const repoSettings = runtimeConfig.repo;
  const themeSettings = runtimeConfig.theme;
  const themeStorageKey = "nullbyte-blog-theme";

  const library = {
    bootstrap: bootstrap,
    parseRoute: parseRoute,
    validateRouteSegment: validateRouteSegment,
    parseFrontMatter: parseFrontMatter,
    parseMarkdownPost: parseMarkdownPost,
    sortPostsByDate: sortPostsByDate,
    groupPostsByYear: groupPostsByYear,
    filterPostsByCategory: filterPostsByCategory,
    filterPostsBySearch: filterPostsBySearch,
    discoverMarkdownFilesFromTree: discoverMarkdownFilesFromTree,
    inferRepositoryContext: inferRepositoryContext,
    renderMarkdownFragment: function (markdownText, sourcePath, documentRef) {
      return renderMarkdownFragment(markdownText, sourcePath, documentRef || document);
    }
  };

  window.NullbyteBlog = library;

  if (runtimeConfig.autoBoot !== false) {
    document.addEventListener("DOMContentLoaded", function () {
      window.NullbyteBlogRuntime = bootstrap({ documentRef: document });
    });
  }

  function bootstrap(options) {
    const documentRef = options && options.documentRef ? options.documentRef : document;
    const rootWindow = options && options.rootWindow ? options.rootWindow : (documentRef.defaultView || window);
    const routeAdapter = options && options.routeAdapter ? options.routeAdapter : createBrowserRouteAdapter(rootWindow);
    const dataSource = options && options.dataSource ? options.dataSource : createRuntimeDataSource(documentRef, rootWindow);
    const state = {
      documentRef: documentRef,
      rootWindow: rootWindow,
      routeAdapter: routeAdapter,
      dataSource: dataSource,
      panelContent: documentRef.getElementById("panel-content"),
      panelTab: documentRef.getElementById("panel-tab"),
      panelTools: documentRef.getElementById("panel-tools"),
      siteName: documentRef.getElementById("site-name"),
      statusLabel: documentRef.getElementById("status-label"),
      themeToggle: documentRef.getElementById("theme-toggle"),
      statusContext: documentRef.getElementById("status-context"),
      categoryNav: documentRef.getElementById("toolbar-categories"),
      renderPromise: Promise.resolve(),
      readyPromise: null,
      resolveReady: null,
      ready: false,
      postsPromise: null,
      posts: [],
      invalidPosts: [],
      currentRoute: null,
      lastCollectionHash: "#/",
      renderSequence: 0,
      pendingNavigations: [],
      searchQuery: "",
      themeMode: normalizeThemeMode(themeSettings.defaultMode)
    };
    const controller = {
      navigate: navigate,
      whenReady: function () {
        return state.readyPromise;
      },
      waitForIdle: function () {
        return state.renderPromise;
      },
      getSnapshot: getSnapshot,
      loadPosts: loadPosts,
      dataSource: dataSource,
      documentRef: documentRef
    };

    state.readyPromise = new Promise(function (resolve) {
      state.resolveReady = resolve;
    });

    if (!state.panelContent || !state.panelTab || !state.panelTools || !state.statusContext || !state.categoryNav) {
      finalizeReady();
      return controller;
    }

    applyRuntimeChrome();
    initializeTheme();
    renderLoadingState("BOOT", "Loading client libraries...");
    waitForLibraries(4000).then(function () {
      configureMarkdown();
      bindEvents();
      if (!routeAdapter.getHash()) {
        routeAdapter.setHash("#/");
        if (!routeAdapter.firesChangeEvent) {
          handleRouteChange();
        }
      } else {
        handleRouteChange();
      }
    }).catch(function (error) {
      renderErrorState("Dependency load failure", error.message, "#/");
      updateStatus("dependency load failure");
      finalizeReady();
    });

    return controller;

    function bindEvents() {
      if (typeof routeAdapter.addChangeListener === "function") {
        routeAdapter.addChangeListener(handleRouteChange);
      }
      if (state.themeToggle && themeSettings.allowToggle) {
        state.themeToggle.addEventListener("click", toggleTheme);
      }
    }

    function handleRouteChange() {
      state.renderPromise = renderCurrentRoute().finally(flushPendingNavigations);
      return state.renderPromise;
    }

    async function navigate(hashValue) {
      const normalizedHash = normalizeHash(hashValue);
      if (routeAdapter.getHash() === normalizedHash) {
        return handleRouteChange();
      }
      return new Promise(function (resolve) {
        state.pendingNavigations.push(resolve);
        routeAdapter.setHash(normalizedHash);
        if (!routeAdapter.firesChangeEvent) {
          handleRouteChange();
        }
      });
    }

    function flushPendingNavigations() {
      while (state.pendingNavigations.length > 0) {
        const resolve = state.pendingNavigations.shift();
        resolve();
      }
    }

    async function loadPosts() {
      if (!state.postsPromise) {
        state.postsPromise = dataSource.loadPosts().then(function (payload) {
          state.posts = sortPostsByDate(payload.posts || []);
          state.invalidPosts = payload.invalidPosts || [];
          return state.posts;
        }).catch(function (error) {
          state.postsPromise = null;
          throw error;
        });
      }
      return state.postsPromise;
    }

    async function renderCurrentRoute() {
      const previousRoute = state.currentRoute;
      const route = parseRoute(routeAdapter.getHash());
      const renderId = ++state.renderSequence;
      trackCollectionRoute(previousRoute, route);
      state.currentRoute = route;
      updateToolbarState(route);
      setRouteMarkers(route);
      try {
        if (route.type === "home") {
          await renderHomeView(renderId);
        } else if (route.type === "category") {
          await renderCategoryView(route, renderId);
        } else if (route.type === "post") {
          await renderPostView(route, renderId);
        } else if (route.type === "about") {
          renderAboutView();
        } else {
          renderNotFoundView(route.reason || "The requested location does not exist.");
        }
      } catch (error) {
        if (!isActiveRender(renderId)) {
          return;
        }
        if (error.code === "file-protocol-unsupported") {
          renderHostedOnlyState(error.message);
        } else if (error.code === "repo-context-required") {
          renderRepositorySetupState(error.message);
        } else {
          renderErrorState("Render failure", error.message, "#/");
          updateStatus("render failure");
        }
      }
      if (isActiveRender(renderId)) {
        finalizeReady();
        dispatchIdle(route);
      }
    }

    function finalizeReady() {
      if (!state.ready) {
        state.ready = true;
        state.resolveReady();
      }
    }

    function isActiveRender(renderId) {
      return renderId === state.renderSequence;
    }

    function applyRuntimeChrome() {
      if (state.siteName) {
        state.siteName.textContent = siteSettings.name;
      }
      if (state.statusLabel) {
        state.statusLabel.textContent = siteSettings.statusLabel;
      }
      if (state.themeToggle) {
        state.themeToggle.hidden = !themeSettings.allowToggle;
      }
      updateDocumentTitle(rootTitle);
    }

    function initializeTheme() {
      applyTheme(readStoredTheme() || normalizeThemeMode(themeSettings.defaultMode));
    }

    function toggleTheme() {
      const nextTheme = state.themeMode === "dark" ? "light" : "dark";
      applyTheme(nextTheme);
      writeStoredTheme(nextTheme);
    }

    function applyTheme(themeMode) {
      const normalizedTheme = normalizeThemeMode(themeMode);
      state.themeMode = normalizedTheme;
      if (documentRef.documentElement) {
        documentRef.documentElement.dataset.theme = normalizedTheme;
        documentRef.documentElement.style.colorScheme = normalizedTheme;
      }
      if (state.themeToggle) {
        state.themeToggle.textContent = normalizedTheme;
        state.themeToggle.setAttribute("aria-label", "Switch to " + (normalizedTheme === "dark" ? "light" : "dark") + " mode");
        state.themeToggle.setAttribute("aria-pressed", normalizedTheme === "dark" ? "true" : "false");
      }
    }

    function readStoredTheme() {
      try {
        return normalizeThemeMode(rootWindow.localStorage.getItem(themeStorageKey));
      } catch (error) {
        return "";
      }
    }

    function writeStoredTheme(themeMode) {
      try {
        rootWindow.localStorage.setItem(themeStorageKey, normalizeThemeMode(themeMode));
      } catch (error) {
      }
    }

    function configureMarkdown() {
      window.marked.use({
        gfm: true,
        breaks: false
      });
    }

    async function renderHomeView(renderId) {
      if (!state.postsPromise) {
        renderLoadingState("POST LIST", "Discovering posts...");
      }
      const posts = await loadPosts();
      if (!isActiveRender(renderId)) {
        return;
      }
      const filteredPosts = filterPostsBySearch(posts, state.searchQuery);
      const categories = getSortedCategories(posts);
      const filteredCategories = getSortedCategories(filteredPosts);
      updateCategoryLinks(categories);
      syncSearchControls({
        routeType: "home",
        placeholder: "Search articles, tags, categories",
        helperText: "Title, category, slug, description, and tags"
      });
      const root = createElement("section", "view view-home");
      root.dataset.view = "home";
      root.appendChild(createViewIntro("Index", siteSettings.homeTitle, buildHomeSummary(filteredPosts.length, filteredCategories.length, state.searchQuery)));
      if (state.invalidPosts.length > 0) {
        root.appendChild(createNoticeCard(state.invalidPosts.length + " markdown file" + (state.invalidPosts.length === 1 ? " was" : "s were") + " ignored because metadata was missing or invalid."));
      }
      if (posts.length === 0) {
        root.appendChild(createEmptyState("No articles have been published yet."));
      } else if (filteredPosts.length === 0) {
        root.appendChild(createEmptyState('No articles match "' + state.searchQuery + '".'));
      } else {
        root.appendChild(createGroupedPostList(groupPostsByYear(filteredPosts), true));
      }
      replaceContent(root);
      updatePanelTab("POST LIST");
      updateStatus(buildCollectionStatus(filteredPosts.length, state.searchQuery));
      updateDocumentTitle(rootTitle);
    }

    async function renderCategoryView(route, renderId) {
      if (!state.postsPromise) {
        renderLoadingState("CATEGORY", "Loading category index...");
      }
      const posts = await loadPosts();
      if (!isActiveRender(renderId)) {
        return;
      }
      updateCategoryLinks(getSortedCategories(posts));
      const categoryPosts = filterPostsByCategory(posts, route.category);
      const filteredPosts = filterPostsBySearch(categoryPosts, state.searchQuery);
      syncSearchControls({
        routeType: "category",
        placeholder: "Search in " + route.category,
        helperText: "Title, slug, description, and tags in " + route.category
      });
      const root = createElement("section", "view view-category");
      root.dataset.view = "category";
      root.dataset.category = route.category;
      root.appendChild(createViewIntro("Category", route.category, buildCategorySummary(filteredPosts.length, state.searchQuery)));
      if (categoryPosts.length === 0) {
        root.appendChild(createEmptyState("No articles in this category yet."));
      } else if (filteredPosts.length === 0) {
        root.appendChild(createEmptyState('No articles in this category match "' + state.searchQuery + '".'));
      } else {
        root.appendChild(createGroupedPostList(groupPostsByYear(filteredPosts), false));
      }
      replaceContent(root);
      updatePanelTab("CATEGORY " + route.category.toUpperCase());
      updateStatus(buildCategoryStatus(route.category, filteredPosts.length, state.searchQuery));
      updateDocumentTitle(route.category + " | " + rootTitle);
    }

    async function renderPostView(route, renderId) {
      renderLoadingState("POST", "Loading markdown...");
      const posts = await loadPosts();
      if (!isActiveRender(renderId)) {
        return;
      }
      updateCategoryLinks(getSortedCategories(posts));
      clearSearchControls();
      const post = posts.find(function (entry) {
        return entry.category === route.category && entry.slug === route.slug;
      });
      if (!post) {
        renderNotFoundView("The requested post does not exist.");
        return;
      }
      const markdownBody = post.body || await dataSource.loadPostBody(post);
      if (!isActiveRender(renderId)) {
        return;
      }
      const root = createElement("article", "view view-post");
      root.dataset.view = "post";
      root.dataset.category = route.category;
      root.dataset.slug = route.slug;
      root.appendChild(createBackLink(post));
      root.appendChild(createPostHeader(post));
      root.appendChild(renderMarkdownFragment(markdownBody, post.path, documentRef));
      replaceContent(root);
      updatePanelTab("POST " + route.category.toUpperCase());
      updateStatus(post.category + "/" + post.slug);
      updateDocumentTitle(post.title + " | " + rootTitle);
    }

    function renderAboutView() {
      clearSearchControls();
      const root = createElement("section", "view view-about");
      root.dataset.view = "about";
      root.appendChild(createViewIntro("About", profileSettings.name, profileSettings.handle));
      root.appendChild(createAboutProfileCard(profileSettings));
      replaceContent(root);
      updatePanelTab("ABOUT");
      updateStatus("about profile");
      updateDocumentTitle("About | " + rootTitle);
    }

    function renderNotFoundView(message) {
      clearSearchControls();
      const root = createElement("section", "view view-not-found");
      root.dataset.view = "not-found";
      root.appendChild(createViewIntro("404", "Route not found", message));
      root.appendChild(createActionLink("Return home", "#/", "action-link"));
      replaceContent(root);
      updatePanelTab("404");
      updateStatus("404 not found");
      updateDocumentTitle("404 | " + rootTitle);
    }

    function renderHostedOnlyState(message) {
      clearSearchControls();
      const root = createElement("section", "view view-setup");
      root.dataset.view = "setup";
      root.appendChild(createViewIntro("Hosted Preview", "Serve this through GitHub Pages", message));
      root.appendChild(createNoticeCard("Automatic discovery always reads ./posts from the hosted site. Browsers do not expose folder listing or relative fetch access from file:// pages."));
      replaceContent(root);
      updatePanelTab("HOSTED PREVIEW");
      updateStatus("serve through github pages");
      updateDocumentTitle("Hosted Preview | " + rootTitle);
    }

    function renderRepositorySetupState(message) {
      clearSearchControls();
      const root = createElement("section", "view view-setup");
      root.dataset.view = "setup";
      root.appendChild(createViewIntro("Repository Setup", "Unable to discover posts", message));
      root.appendChild(createNoticeCard("Set repo.owner, repo.name, and repo.branch in config.js. The app uses that repository to discover ./posts through the GitHub API on localhost, custom domains, and any non-github.io URL."));
      replaceContent(root);
      updatePanelTab("SETUP");
      updateStatus("repository setup needed");
      updateDocumentTitle("Setup | " + rootTitle);
    }

    function renderLoadingState(label, statusText) {
      clearSearchControls();
      const root = createElement("section", "view loading-state");
      root.dataset.view = "loading";
      root.appendChild(createViewIntro("Loading", "Preparing view", statusText));
      replaceContent(root);
      updatePanelTab(label);
      updateStatus(statusText);
    }

    function renderErrorState(title, message, recoveryHash) {
      clearSearchControls();
      const root = createElement("section", "view error-state");
      root.dataset.view = "error";
      root.appendChild(createViewIntro("Error", title, message));
      if (recoveryHash) {
        root.appendChild(createActionLink("Return home", recoveryHash, "action-link"));
      }
      replaceContent(root);
      updatePanelTab("ERROR");
      updateDocumentTitle("Error | " + rootTitle);
    }

    function createViewIntro(kickerText, titleText, summaryText) {
      const wrapper = createElement("header", "view-intro");
      wrapper.appendChild(createElement("div", "view-kicker", kickerText));
      wrapper.appendChild(createElement("h1", "view-title", titleText));
      wrapper.appendChild(createParagraph("view-summary", summaryText));
      return wrapper;
    }

    function createNoticeCard(textValue) {
      return createElement("p", "notice-card", textValue);
    }

    function syncSearchControls(options) {
      let shell = state.panelTools.querySelector(".search-shell");
      if (!shell) {
        shell = createElement("div", "search-shell");
        const label = createElement("label", "search-label", "Search");
        label.setAttribute("for", "article-search");
        const input = documentRef.createElement("input");
        input.id = "article-search";
        input.className = "search-input";
        input.type = "search";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.maxLength = 80;
        input.addEventListener("input", function (event) {
          state.searchQuery = normalizeSearchQuery(event.target.value);
          if (event.target.value !== state.searchQuery) {
            event.target.value = state.searchQuery;
          }
          handleRouteChange();
        });
        const helper = createElement("p", "search-helper");
        shell.appendChild(label);
        shell.appendChild(input);
        shell.appendChild(helper);
        state.panelTools.replaceChildren(shell);
      }
      state.panelTools.classList.add("has-search");
      const input = shell.querySelector(".search-input");
      const helper = shell.querySelector(".search-helper");
      shell.dataset.scope = options.routeType;
      input.placeholder = options.placeholder;
      if (input.value !== state.searchQuery) {
        input.value = state.searchQuery;
      }
      helper.textContent = options.helperText;
    }

    function clearSearchControls() {
      state.panelTools.classList.remove("has-search");
      state.panelTools.replaceChildren();
    }

    function createGroupedPostList(groupedPosts, showCategoryTag) {
      const wrapper = createElement("div", "post-groups");
      groupedPosts.forEach(function (group) {
        const section = createElement("section", "year-group");
        section.appendChild(createElement("h2", "year-heading", group.year));
        const list = createElement("div", "post-list");
        group.posts.forEach(function (post) {
          list.appendChild(createPostRow(post, showCategoryTag));
        });
        section.appendChild(list);
        wrapper.appendChild(section);
      });
      return wrapper;
    }

    function createPostRow(post, showCategoryTag) {
      const row = createActionLink("", "#/post/" + post.category + "/" + post.slug, "post-row");
      row.dataset.category = post.category;
      row.dataset.slug = post.slug;
      if (!showCategoryTag) {
        row.classList.add("post-row-simple");
      }
      row.appendChild(createElement("span", "post-row-date", post.date));
      row.appendChild(createElement("span", "post-row-title", post.title));
      if (showCategoryTag) {
        row.appendChild(createElement("span", "category-tag", post.category));
      }
      return row;
    }

    function createBackLink(post) {
      const target = resolveBackTarget(post.category);
      return createActionLink(target.label, target.href, "back-link");
    }

    function resolveBackTarget(category) {
      if (state.lastCollectionHash && state.lastCollectionHash.indexOf("#/category/") === 0) {
        return {
          href: state.lastCollectionHash,
          label: "Return to category"
        };
      }
      if (state.lastCollectionHash === "#/") {
        return {
          href: "#/",
          label: "Return to all posts"
        };
      }
      return {
        href: "#/category/" + category,
        label: "Return to " + category
      };
    }

    function createPostHeader(post) {
      const header = createElement("header", "post-header");
      header.appendChild(createElement("h1", "post-title", post.title));
      if (post.description) {
        header.appendChild(createParagraph("post-description", post.description));
      }
      const metaLine = createElement("div", "post-meta-line");
      metaLine.appendChild(createElement("span", "post-meta-date", post.date));
      metaLine.appendChild(createElement("span", "category-tag", post.category));
      header.appendChild(metaLine);
      if (post.tags.length > 0) {
        const tagList = createElement("div", "tag-list");
        post.tags.forEach(function (tag) {
          tagList.appendChild(createElement("span", "tag-chip", tag));
        });
        header.appendChild(tagList);
      }
      return header;
    }

    function createSocialLinks(links) {
      const wrapper = createElement("div", "social-links");
      links.forEach(function (link) {
        wrapper.appendChild(createExternalLink(link.label, link.href, "social-link"));
      });
      return wrapper;
    }

    function createAboutProfileCard(profile) {
      const wrapper = createElement("section", "about-profile");
      if (profile.pfp) {
        const avatar = documentRef.createElement("img");
        avatar.className = "profile-avatar";
        avatar.src = profile.pfp;
        avatar.alt = profile.name;
        wrapper.appendChild(avatar);
      }
      const body = createElement("div", "about-profile-body");
      body.appendChild(createProfileBio(profile.bio));
      body.appendChild(createSocialLinks(profile.links));
      wrapper.appendChild(body);
      return wrapper;
    }

    function createProfileBio(content) {
      const paragraph = createElement("p", "profile-bio");
      if (Array.isArray(content)) {
        content.forEach(function (part) {
          if (typeof part === "string") {
            paragraph.appendChild(documentRef.createTextNode(part));
          } else if (part && part.href) {
            paragraph.appendChild(createExternalLink(part.label, part.href, "profile-inline-link"));
          } else if (part && part.text) {
            paragraph.appendChild(documentRef.createTextNode(part.text));
          }
        });
      } else {
        paragraph.textContent = content;
      }
      return paragraph;
    }

    function createParagraph(className, textValue) {
      return createElement("p", className, textValue);
    }

    function createEmptyState(message) {
      return createElement("div", "empty-state", message);
    }

    function createActionLink(label, href, className) {
      const link = documentRef.createElement("a");
      link.className = className;
      link.href = href;
      if (label) {
        link.textContent = label;
      }
      return link;
    }

    function createExternalLink(label, href, className) {
      const link = createActionLink(label, href, className);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }

    function createElement(tagName, className, textValue) {
      const element = documentRef.createElement(tagName);
      if (className) {
        element.className = className;
      }
      if (typeof textValue === "string") {
        element.textContent = textValue;
      }
      return element;
    }

    function replaceContent(node) {
      state.panelContent.replaceChildren(node);
    }

    function updatePanelTab(label) {
      state.panelTab.textContent = label;
    }

    function updateStatus(message) {
      state.statusContext.textContent = message;
    }

    function updateDocumentTitle(title) {
      if (documentRef.title !== undefined) {
        documentRef.title = title;
      }
    }

    function updateCategoryLinks(categories) {
      state.categoryNav.replaceChildren();
      categories.forEach(function (category) {
        const link = createActionLink(category, "#/category/" + category, "toolbar-link");
        link.dataset.nav = "category:" + category;
        state.categoryNav.appendChild(link);
      });
      updateToolbarState(state.currentRoute);
    }

    function updateToolbarState(route) {
      documentRef.querySelectorAll(".toolbar-link").forEach(function (link) {
        link.classList.remove("is-active");
      });
      if (!route) {
        return;
      }
      let targetKey = "";
      if (route.type === "home") {
        targetKey = "home";
      } else if (route.type === "about") {
        targetKey = "about";
      } else if (route.type === "category" || route.type === "post") {
        targetKey = "category:" + route.category;
      }
      if (!targetKey) {
        return;
      }
      const activeLink = documentRef.querySelector('.toolbar-link[data-nav="' + targetKey + '"]');
      if (activeLink) {
        activeLink.classList.add("is-active");
      }
    }

    function trackCollectionRoute(previousRoute, nextRoute) {
      if (previousRoute && (previousRoute.type === "home" || previousRoute.type === "category") && nextRoute.type === "post") {
        state.lastCollectionHash = previousRoute.hash;
        return;
      }
      if (nextRoute.type === "home" || nextRoute.type === "category") {
        state.lastCollectionHash = nextRoute.hash;
      }
    }

    function setRouteMarkers(route) {
      if (!documentRef.body) {
        return;
      }
      documentRef.body.dataset.routeType = route.type;
      documentRef.body.dataset.routeHash = route.hash;
      if (route.category) {
        documentRef.body.dataset.routeCategory = route.category;
      } else {
        delete documentRef.body.dataset.routeCategory;
      }
      if (route.slug) {
        documentRef.body.dataset.routeSlug = route.slug;
      } else {
        delete documentRef.body.dataset.routeSlug;
      }
    }

    function dispatchIdle(route) {
      if (!rootWindow || typeof rootWindow.dispatchEvent !== "function" || typeof rootWindow.CustomEvent !== "function") {
        return;
      }
      rootWindow.dispatchEvent(new rootWindow.CustomEvent("nullbyte:idle", { detail: route }));
    }

    function getSnapshot() {
      return {
        route: state.currentRoute,
        sourceMode: dataSource.mode,
        postCount: state.posts.length,
        invalidPostsCount: state.invalidPosts.length,
        lastCollectionHash: state.lastCollectionHash,
        status: state.statusContext.textContent
      };
    }
  }

  function createBrowserRouteAdapter(rootWindow) {
    return {
      firesChangeEvent: true,
      getHash: function () {
        return rootWindow.location.hash;
      },
      setHash: function (hashValue) {
        rootWindow.location.hash = normalizeHash(hashValue);
      },
      addChangeListener: function (listener) {
        rootWindow.addEventListener("hashchange", listener);
      }
    };
  }

  function createRuntimeDataSource(documentRef, rootWindow) {
    if (rootWindow.location && rootWindow.location.protocol === "file:") {
      return createFileProtocolSource();
    }
    return createRepositorySource(documentRef, rootWindow);
  }

  function createFileProtocolSource() {
    return {
      mode: "file",
      loadPosts: async function () {
        throw createCodeError("file-protocol-unsupported", "Open the hosted site instead of the raw file. Automatic ./posts discovery only works when the blog is served over HTTP.");
      },
      loadPostBody: async function () {
        throw createCodeError("file-protocol-unsupported", "Open the hosted site instead of the raw file. Automatic ./posts discovery only works when the blog is served over HTTP.");
      }
    };
  }

  function createRepositorySource(documentRef, rootWindow) {
    let repositoryContextPromise = null;
    const parsedPostCache = new Map();

    return {
      mode: "github",
      loadPosts: async function () {
        const repositoryContext = await resolveRepositoryContext(documentRef, rootWindow);
        const treeUrl = "https://api.github.com/repos/" + encodeURIComponent(repositoryContext.owner) + "/" + encodeURIComponent(repositoryContext.repo) + "/git/trees/" + encodeURIComponent(repositoryContext.branch) + "?recursive=1";
        const treeResponse = await fetchJson(treeUrl, {
          Accept: "application/vnd.github+json"
        });
        const markdownPaths = discoverMarkdownFilesFromTree(treeResponse.tree || []);
        const discoveredPosts = [];
        const invalidPosts = [];
        for (let index = 0; index < markdownPaths.length; index += 1) {
          const pathValue = markdownPaths[index];
          const pathContext = parsePostPath(pathValue);
          if (!pathContext) {
            invalidPosts.push({ path: pathValue, reason: "Unsupported posts path." });
            continue;
          }
          try {
            const markdownText = await fetchMarkdownPath(pathValue, repositoryContext);
            const parsed = parseMarkdownPost(markdownText, pathContext);
            if (parsed.post) {
              discoveredPosts.push(parsed.post);
              parsedPostCache.set(parsed.post.path, parsed.post);
            } else {
              invalidPosts.push({ path: pathValue, reason: parsed.reason });
            }
          } catch (error) {
            invalidPosts.push({ path: pathValue, reason: error.message });
          }
        }
        return {
          posts: discoveredPosts,
          invalidPosts: invalidPosts
        };
      },
      loadPostBody: async function (post) {
        const cached = parsedPostCache.get(post.path);
        if (cached && cached.body) {
          return cached.body;
        }
        const repositoryContext = await resolveRepositoryContext(documentRef, rootWindow);
        const markdownText = await fetchMarkdownPath(post.path, repositoryContext);
        const parsed = parseMarkdownPost(markdownText, {
          category: post.category,
          slug: post.slug,
          path: post.path
        });
        if (!parsed.post) {
          throw createCodeError("post-read-failed", parsed.reason);
        }
        parsedPostCache.set(post.path, parsed.post);
        return parsed.post.body;
      }
    };

    async function resolveRepositoryContext(documentNode, windowNode) {
      if (!repositoryContextPromise) {
        repositoryContextPromise = Promise.resolve(inferRepositoryContext(documentNode, windowNode)).then(async function (context) {
          if (!context || !context.owner || !context.repo) {
            throw createCodeError("repo-context-required", "Unable to infer the GitHub repository. Set repo.owner and repo.name in config.js.");
          }
          if (context.branch) {
            return context;
          }
          const repoUrl = "https://api.github.com/repos/" + encodeURIComponent(context.owner) + "/" + encodeURIComponent(context.repo);
          const repoResponse = await fetchJson(repoUrl, {
            Accept: "application/vnd.github+json"
          });
          return {
            owner: context.owner,
            repo: context.repo,
            branch: repoResponse.default_branch || "main"
          };
        }).catch(function (error) {
          repositoryContextPromise = null;
          throw error;
        });
      }
      return repositoryContextPromise;
    }
  }

  async function fetchMarkdownPath(pathValue, repositoryContext) {
    try {
      return await fetchText(pathValue);
    } catch (error) {
      const rawUrl = "https://raw.githubusercontent.com/" + encodeURIComponent(repositoryContext.owner) + "/" + encodeURIComponent(repositoryContext.repo) + "/" + encodeURIComponent(repositoryContext.branch) + "/" + pathValue;
      return fetchText(rawUrl);
    }
  }

  async function fetchJson(url, headers) {
    let response;
    try {
      response = await fetch(url, { headers: headers || {} });
    } catch (error) {
      throw new Error("Unable to reach " + url + ".");
    }
    if (!response.ok) {
      throw new Error(buildResponseErrorMessage(url, response, await tryReadJsonMessage(response)));
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(url + " did not return valid JSON.");
    }
  }

  async function fetchText(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/markdown, text/plain"
        }
      });
    } catch (error) {
      throw new Error("Unable to reach " + url + ".");
    }
    if (!response.ok) {
      throw new Error(buildResponseErrorMessage(url, response));
    }
    return response.text();
  }

  async function tryReadJsonMessage(response) {
    try {
      const clone = response.clone();
      const payload = await clone.json();
      return payload && payload.message ? payload.message : "";
    } catch (error) {
      return "";
    }
  }

  function buildResponseErrorMessage(url, response, detail) {
    const suffix = detail ? " " + detail : "";
    return "Received " + response.status + " while loading " + url + "." + suffix;
  }

  async function waitForLibraries(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (window.marked && window.DOMPurify && window.hljs) {
        return;
      }
      await delay(50);
    }
    throw new Error("One or more CDN dependencies did not finish loading.");
  }

  function delay(timeoutMs) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, timeoutMs);
    });
  }

  function parseRoute(hashValue) {
    const normalizedHash = normalizeHash(hashValue);
    if (normalizedHash === "#/") {
      return { type: "home", hash: "#/" };
    }
    if (normalizedHash.indexOf("#/") !== 0) {
      return { type: "not-found", hash: normalizedHash, reason: "Unsupported route format." };
    }
    const rawPath = normalizedHash.slice(2);
    const rawSegments = rawPath.split("/");
    const decodedSegments = [];
    for (let index = 0; index < rawSegments.length; index += 1) {
      if (!rawSegments[index]) {
        return { type: "not-found", hash: normalizedHash, reason: "Incomplete route." };
      }
      try {
        decodedSegments.push(decodeURIComponent(rawSegments[index]));
      } catch (error) {
        return { type: "not-found", hash: normalizedHash, reason: "Malformed route encoding." };
      }
    }
    if (decodedSegments.length === 1 && decodedSegments[0] === "about") {
      return { type: "about", hash: normalizedHash };
    }
    if (decodedSegments.length === 2 && decodedSegments[0] === "category") {
      if (!validateRouteSegment(decodedSegments[1])) {
        return { type: "not-found", hash: normalizedHash, reason: "Invalid category route." };
      }
      return { type: "category", hash: normalizedHash, category: decodedSegments[1] };
    }
    if (decodedSegments.length === 3 && decodedSegments[0] === "post") {
      if (!validateRouteSegment(decodedSegments[1]) || !validateRouteSegment(decodedSegments[2])) {
        return { type: "not-found", hash: normalizedHash, reason: "Invalid post route." };
      }
      return {
        type: "post",
        hash: normalizedHash,
        category: decodedSegments[1],
        slug: decodedSegments[2]
      };
    }
    return { type: "not-found", hash: normalizedHash, reason: "Unknown route." };
  }

  function normalizeHash(hashValue) {
    if (!hashValue || hashValue === "#") {
      return "#/";
    }
    return hashValue;
  }

  function validateRouteSegment(value) {
    return typeof value === "string" && routeSegmentPattern.test(value);
  }

  function parseFrontMatter(markdownText) {
    const normalizedText = String(markdownText || "").replace(/\r\n?/g, "\n");
    if (!normalizedText.startsWith("---\n")) {
      return {
        attributes: {},
        body: normalizedText.trim(),
        hasFrontMatter: false
      };
    }
    const closingIndex = normalizedText.indexOf("\n---\n", 4);
    if (closingIndex === -1) {
      return {
        attributes: {},
        body: normalizedText.trim(),
        hasFrontMatter: false
      };
    }
    const rawFrontMatter = normalizedText.slice(4, closingIndex);
    const body = normalizedText.slice(closingIndex + 5).trim();
    const attributes = {};
    rawFrontMatter.split("\n").forEach(function (line) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return;
      }
      const separatorIndex = trimmedLine.indexOf(":");
      if (separatorIndex === -1) {
        return;
      }
      const key = trimmedLine.slice(0, separatorIndex).trim().toLowerCase();
      const value = trimmedLine.slice(separatorIndex + 1).trim();
      attributes[key] = value;
    });
    return {
      attributes: attributes,
      body: body,
      hasFrontMatter: true
    };
  }

  function parseMarkdownPost(markdownText, context) {
    const parsedFrontMatter = parseFrontMatter(markdownText);
    const title = normalizeTextField(parsedFrontMatter.attributes.title);
    const date = normalizeDateField(parsedFrontMatter.attributes.date);
    const description = normalizeTextField(parsedFrontMatter.attributes.description);
    const tags = normalizeTagList(parsedFrontMatter.attributes.tags);
    if (!title) {
      return { post: null, reason: "Missing title metadata." };
    }
    if (!date) {
      return { post: null, reason: "Missing or invalid date metadata." };
    }
    return {
      post: {
        title: title,
        date: date,
        category: context.category,
        slug: context.slug,
        description: description,
        tags: tags,
        body: parsedFrontMatter.body,
        path: context.path
      }
    };
  }

  function normalizeTextField(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeDateField(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return "";
    }
    const normalizedValue = value.trim();
    const timestamp = Date.parse(normalizedValue + "T00:00:00Z");
    return Number.isNaN(timestamp) ? "" : normalizedValue;
  }

  function normalizeTagList(value) {
    if (typeof value !== "string" || !value.trim()) {
      return [];
    }
    const normalizedValue = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    return normalizedValue.split(",").map(function (entry) {
      return entry.trim();
    }).filter(Boolean);
  }

  function sortPostsByDate(posts) {
    return posts.slice().sort(function (left, right) {
      return Date.parse(right.date + "T00:00:00Z") - Date.parse(left.date + "T00:00:00Z");
    });
  }

  function groupPostsByYear(posts) {
    const groups = [];
    posts.forEach(function (post) {
      const year = post.date.slice(0, 4);
      const currentGroup = groups[groups.length - 1];
      if (!currentGroup || currentGroup.year !== year) {
        groups.push({ year: year, posts: [post] });
      } else {
        currentGroup.posts.push(post);
      }
    });
    return groups;
  }

  function filterPostsByCategory(posts, category) {
    return posts.filter(function (post) {
      return post.category === category;
    });
  }

  function filterPostsBySearch(posts, query) {
    const normalizedQuery = normalizeSearchQuery(query).toLowerCase();
    if (!normalizedQuery) {
      return posts.slice();
    }
    const terms = normalizedQuery.split(" ");
    return posts.filter(function (post) {
      const haystack = [
        post.title,
        post.description,
        post.category,
        post.slug
      ].concat(post.tags || []).join(" ").toLowerCase();
      return terms.every(function (term) {
        return haystack.indexOf(term) !== -1;
      });
    });
  }

  function getSortedCategories(posts) {
    return Array.from(new Set(posts.map(function (post) {
      return post.category;
    }))).sort();
  }

  function normalizeSearchQuery(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function buildHomeSummary(articleCount, categoryCount, query) {
    if (query) {
      return articleCount + " " + pluralize(articleCount, "article") + ' matching "' + query + '" in ' + categoryCount + " " + pluralize(categoryCount, "category");
    }
    return articleCount + " " + pluralize(articleCount, "article") + " in " + categoryCount + " " + pluralize(categoryCount, "category");
  }

  function buildCategorySummary(articleCount, query) {
    if (query) {
      return articleCount + " " + pluralize(articleCount, "article") + ' matching "' + query + '"';
    }
    return articleCount + " " + pluralize(articleCount, "article");
  }

  function buildCollectionStatus(articleCount, query) {
    if (query) {
      return articleCount + " matching " + pluralize(articleCount, "article");
    }
    return articleCount + " " + pluralize(articleCount, "article") + " loaded";
  }

  function buildCategoryStatus(category, articleCount, query) {
    if (query) {
      return category + " - " + articleCount + " matching " + pluralize(articleCount, "article");
    }
    return category + " - " + articleCount + " " + pluralize(articleCount, "article");
  }

  function pluralize(count, singularWord) {
    return count === 1 ? singularWord : singularWord + "s";
  }

  function buildRuntimeConfig(userConfig) {
    const sourceConfig = userConfig && typeof userConfig === "object" ? userConfig : {};
    const siteConfig = sourceConfig.site && typeof sourceConfig.site === "object" ? sourceConfig.site : {};
    const repoConfig = sourceConfig.repo && typeof sourceConfig.repo === "object" ? sourceConfig.repo : {};
    const profileConfig = sourceConfig.profile && typeof sourceConfig.profile === "object" ? sourceConfig.profile : {};
    const themeConfig = sourceConfig.theme && typeof sourceConfig.theme === "object" ? sourceConfig.theme : {};
    return {
      autoBoot: sourceConfig.autoBoot !== false,
      site: {
        title: normalizeTextField(siteConfig.title) || "nullbyte0x Blog",
        name: normalizeTextField(siteConfig.name) || "nullbyte0x",
        homeTitle: normalizeTextField(siteConfig.homeTitle) || "Research Articles",
        statusLabel: normalizeTextField(siteConfig.statusLabel) || "nullbyte0x - security research"
      },
      repo: {
        owner: normalizeTextField(repoConfig.owner),
        name: normalizeTextField(repoConfig.name),
        branch: normalizeTextField(repoConfig.branch) || "main"
      },
      profile: {
        name: normalizeTextField(profileConfig.name) || "Ammar Jokhadar",
        handle: normalizeTextField(profileConfig.handle) || "@nullbyte0x",
        bio: normalizeProfileBio(profileConfig.bio) || "Security researcher. I do vulnerability research and reverse engineering for fun. Breaking things to understand how they work, then writing about it so others can learn too.",
        pfp: normalizeTextField(profileConfig.pfp || profileConfig.avatar),
        links: normalizeLinkItems(profileConfig.links)
      },
      theme: {
        defaultMode: normalizeThemeMode(themeConfig.defaultMode) || "dark",
        allowToggle: themeConfig.allowToggle !== false
      }
    };
  }

  function normalizeProfileBio(value) {
    if (Array.isArray(value)) {
      const parts = value.map(function (item) {
        if (typeof item === "string") {
          return item;
        }
        if (!item || typeof item !== "object") {
          return null;
        }
        const text = normalizeTextField(item.text);
        const label = normalizeTextField(item.label);
        const href = normalizeTextField(item.href);
        if (href && label) {
          return { label: label, href: href };
        }
        return text || null;
      }).filter(function (item) {
        return item !== null && item !== "";
      });
      return parts.length > 0 ? parts : "";
    }
    return normalizeTextField(value);
  }

  function normalizeLinkItems(linkItems) {
    if (!Array.isArray(linkItems) || linkItems.length === 0) {
      return [
        { label: "Twitter/X", href: "https://x.com/YOUR_HANDLE" },
        { label: "LinkedIn", href: "https://linkedin.com/in/YOUR_PROFILE" },
        { label: "YouTube", href: "https://youtube.com/@YOUR_CHANNEL" },
        { label: "GitHub", href: "https://github.com/nullbyte0x" }
      ];
    }
    return linkItems.map(function (item) {
      return {
        label: normalizeTextField(item && item.label) || "Link",
        href: normalizeTextField(item && item.href)
      };
    }).filter(function (item) {
      return item.href;
    });
  }

  function normalizeThemeMode(value) {
    return value === "light" ? "light" : "dark";
  }

  function discoverMarkdownFilesFromTree(treeEntries) {
    return treeEntries.filter(function (entry) {
      return entry && entry.type === "blob" && typeof entry.path === "string" && /^posts\/[^/]+\/[^/]+\.md$/i.test(entry.path);
    }).map(function (entry) {
      return entry.path;
    }).sort();
  }

  function parsePostPath(pathValue) {
    if (typeof pathValue !== "string") {
      return null;
    }
    const segments = pathValue.split("/");
    if (segments.length !== 3 || segments[0] !== "posts") {
      return null;
    }
    const category = segments[1];
    const filename = segments[2];
    if (!filename.toLowerCase().endsWith(".md")) {
      return null;
    }
    const slug = filename.slice(0, -3);
    if (!validateRouteSegment(category) || !validateRouteSegment(slug)) {
      return null;
    }
    return {
      category: category,
      slug: slug,
      path: pathValue
    };
  }

  function inferRepositoryContext(documentRef, rootWindow) {
    const ownerConfig = normalizeTextField(repoSettings.owner);
    const repoConfig = normalizeTextField(repoSettings.name);
    const branchConfig = normalizeTextField(repoSettings.branch);
    if (ownerConfig && repoConfig) {
      return {
        owner: ownerConfig,
        repo: repoConfig,
        branch: branchConfig || ""
      };
    }
    if (!rootWindow.location || !/\.github\.io$/i.test(rootWindow.location.hostname || "")) {
      return null;
    }
    const owner = rootWindow.location.hostname.replace(/\.github\.io$/i, "");
    const pathSegments = rootWindow.location.pathname.split("/").filter(Boolean);
    const repo = pathSegments.length > 0 ? pathSegments[0] : owner + ".github.io";
    return {
      owner: owner,
      repo: repo,
      branch: branchConfig || ""
    };
  }

  function renderMarkdownFragment(markdownText, sourcePath, documentRef) {
    const targetDocument = documentRef || document;
    const container = targetDocument.createElement("div");
    container.className = "markdown-body";
    const renderedHtml = window.marked.parse(markdownText || "");
    const sanitizedHtml = window.DOMPurify.sanitize(renderedHtml);
    container.innerHTML = sanitizedHtml;
    rewriteRelativeUrls(container, sourcePath);
    secureRenderedContent(container);
    applySyntaxHighlighting(container);
    return container;
  }

  function rewriteRelativeUrls(container, sourcePath) {
    if (!sourcePath) {
      return;
    }
    container.querySelectorAll("a[href], img[src]").forEach(function (node) {
      const attributeName = node.tagName === "IMG" ? "src" : "href";
      const originalValue = node.getAttribute(attributeName) || "";
      if (!isRelativeAssetPath(originalValue)) {
        return;
      }
      node.setAttribute(attributeName, resolveRelativeAssetPath(sourcePath, originalValue));
    });
  }

  function isRelativeAssetPath(value) {
    return value && !/^(?:[a-z]+:|#|\/)/i.test(value);
  }

  function resolveRelativeAssetPath(sourcePath, relativePath) {
    const baseSegments = sourcePath.split("/");
    baseSegments.pop();
    relativePath.split("/").forEach(function (segment) {
      if (!segment || segment === ".") {
        return;
      }
      if (segment === "..") {
        if (baseSegments.length > 0) {
          baseSegments.pop();
        }
        return;
      }
      baseSegments.push(segment);
    });
    return baseSegments.join("/");
  }

  function secureRenderedContent(container) {
    container.querySelectorAll("a[href]").forEach(function (anchor) {
      const href = anchor.getAttribute("href") || "";
      if (href.indexOf("#/") === 0 || href.indexOf("#") === 0) {
        return;
      }
      try {
        const resolvedUrl = new URL(href, window.location.href);
        if (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") {
          if (resolvedUrl.origin !== window.location.origin) {
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
          }
          return;
        }
        if (resolvedUrl.protocol === "mailto:") {
          return;
        }
      } catch (error) {
      }
      anchor.removeAttribute("href");
    });
    container.querySelectorAll("img").forEach(function (image) {
      image.loading = "lazy";
    });
  }

  function applySyntaxHighlighting(container) {
    container.querySelectorAll("pre code").forEach(function (block) {
      window.hljs.highlightElement(block);
    });
  }

  function formatPostCount(count) {
    return count + " post" + (count === 1 ? "" : "s");
  }

  function createCodeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}());
