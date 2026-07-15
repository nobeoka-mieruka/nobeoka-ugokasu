/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        // 仕様書4章：ブランドカラー
        brand: {
          orange: "#ED6A1A",
          "orange-dark": "#D9530B",
          "orange-light": "#FFF0E3",
          ivory: "#FFF9EF",
        },
        ink: {
          DEFAULT: "#262626",
          soft: "#555555",
        },
        accent: {
          welfare: "#39A935",
          childcare: "#F05A9D",
          disaster: "#1976A8",
        },
      },
      fontFamily: {
        // 24章：不要な外部フォントを使用しないため、システムフォントスタックのみ使用
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Hiragino Sans'",
          "'Hiragino Kaku Gothic ProN'",
          "'Yu Gothic'",
          "'Noto Sans JP'",
          "Meiryo",
          "sans-serif",
        ],
      },
      maxWidth: {
        content: "1440px",
      },
    },
  },
  plugins: [],
};
