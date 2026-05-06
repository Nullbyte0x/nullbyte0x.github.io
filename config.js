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
    bio: "Working as a security researcher at ThawdSecurity. I do vulnerability research and reverse engineering for fun. I love understanding how things work. The only thing I love more than code is music.",
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
