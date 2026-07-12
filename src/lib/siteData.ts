interface SiteData {
  name: string;
  description: string;
  tag: string;
  donationPixKey: string;
  defaultImage: string;
  locale: string;
  googleAnalyticsId: string;
}

export const siteData: SiteData = {
  name: "Drop",
  description:
    "Compartilhe arquivos de forma simples, rapida e eficiênte usando uma conexão direta, seja na sua rede local ou na internet.",
  tag: "Compartilhamento rápido e seguro",
  donationPixKey: "cee3846a-a1ab-4e81-83ac-c5edb016fd71",
  defaultImage: "/images/og-image.png",
  locale: "pt-BR",
  googleAnalyticsId: "G-C1DYCGPZPX",
};
