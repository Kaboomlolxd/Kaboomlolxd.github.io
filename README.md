# Jincheng Shen portfolio

Astro portfolio site for selected projects.

## GitHub Pages

Push the `main` branch to the `Kaboomlolxd.github.io` repository. The workflow in `.github/workflows/deploy-pages.yml` builds the site and deploys it to GitHub Pages.

In the repository settings, set **Pages → Source** to **GitHub Actions**.

The workflow builds Astro and publishes only `dist/`. Do not select branch publishing or the Jekyll workflow: Astro frontmatter is JavaScript, not YAML.
