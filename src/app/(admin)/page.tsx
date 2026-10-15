/**
 * Home is the Dashboard. There is no nav item; the logo links here.
 */
export default function HomePage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
        Dashboard
      </h1>
    </div>
  );
}
