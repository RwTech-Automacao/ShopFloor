import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShopFloor",
  description: "MES Enterplak",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        {/* bottom-center: avisos dos cadastros (Config/Recebimento) aparecem embaixo, perto da ação.
            Centralizado (não bottom-right) pra não bater nas setas de navegação e no Finalizar,
            que moram no rodapé à direita. Telas de bipe usam o painel fixo, não toast. */}
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  );
}
