module.exports = {
  title: 'DeepQuasar Docs',
  tagline: 'Modularized command docs',
  url: 'https://karutoil.github.io',
  baseUrl: '/DeepQuasar-Modularized/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.svg',
  organizationName: 'karutoil', // GitHub org/user name
  projectName: 'DeepQuasar-Modularized', // repository name
  deploymentBranch: 'gh-pages',
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          // point to the repo-level docs folder so no copy is needed
          path: '../docs',
          routeBasePath: '/', // serve docs at site's root
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/karutoil/DeepQuasar-Modularized/edit/main/docs/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
  themeConfig: {
  navbar: {
      title: 'DeepQuasar',
      logo: {
        alt: 'DeepQuasar Logo',
        src: 'img/logo-designer.svg',
      },
      items: [
        {to: '/', label: 'Commands', position: 'left'},
        {
          href: 'https://github.com/karutoil/DeepQuasar-Modularized',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    colorMode: {
      // Allow users to switch between light/dark. Default to system preference.
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    prism: {
      theme: require('prism-react-renderer/themes/github'),
      darkTheme: require('prism-react-renderer/themes/dracula'),
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Commands', to: '/'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} karutoil`,
    },
  },
};
