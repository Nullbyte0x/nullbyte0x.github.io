window.NullbyteBlogConfig = {
  autoBoot: true,
  site: {
    title: "nullbyte0x Blog",
    name: "nullbyte0x",
    homeTitle: "Research Articles",
    statusLabel: "nullbyte0x - security research"
  },
  repo: {
    owner: "nullbyte0x",
    name: "nullbyte0x.github.io",
    branch: "main"
  },
  profile: {
    name: "Ammar Jokhadar",
    handle: "@nullbyte0x",
    bio: [
      "Working as a Security Researcher at ",
      { label: "Thawd", href: "https://www.thawd.com.sa/" },
      ". I work on purple teaming, threat detection, threat hunting, and the fun parts of security operations. In my free time, I focus on reverse engineering and exploit development because I’m obsessed with low-level technology and hate not understanding how things work."
    ],
    pfp: "https://media.tenor.com/_WZy7E7hoTcAAAAM/cat-smile.gif",
    links: [
      { label: "Twitter/X", href: "https://x.com/nullbyte0x" },
      { label: "LinkedIn", href: "https://linkedin.com/in/nullbyte0x" },
      { label: "YouTube", href: "https://youtube.com/@nullbyte0x" },
      { label: "GitHub", href: "https://github.com/nullbyte0x" }
    ]
  },
  theme: {
    defaultMode: "dark",
    allowToggle: true
  }
};

(function () {
  const configuredTheme = window.NullbyteBlogConfig.theme && window.NullbyteBlogConfig.theme.defaultMode === "light" ? "light" : "dark";
  let resolvedTheme = configuredTheme;
  try {
    const storedTheme = window.localStorage.getItem("nullbyte-blog-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      resolvedTheme = storedTheme;
    }
  } catch (error) {
  }
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}());
