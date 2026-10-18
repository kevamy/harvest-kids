import Image from "next/image";

/** Sign-in screens: the only place, with the footer, showing the Harvest Kids logo. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh grid-rows-[1fr_auto]">
      <main className="mx-auto grid w-full max-w-md content-center gap-8 px-6 py-10">
        <Image
          src="/logo/harvest-kids.svg"
          alt="Harvest Kids"
          width={220}
          height={80}
          className="mx-auto h-20 w-auto"
          priority
        />
        {children}
      </main>
      <footer className="py-6 text-center text-caption text-texte-doux">Harvest Kids</footer>
    </div>
  );
}
