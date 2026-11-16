/** About Us, Privacy Policy and Terms of Service, from Markdown files so the client's text can replace them without code changes (PRD P1-12). */
import Markdown from 'react-markdown';
import about from '../content/about.md?raw';
import privacy from '../content/privacy.md?raw';
import terms from '../content/terms.md?raw';

const pages = { about, privacy, terms };

/** Renders one of the site's Markdown pages. Raw HTML in the files is shown as text, never run. */
function InformationPage({ page }: { page: keyof typeof pages }) {
  return (
    <div className="card markdown">
      <Markdown>{pages[page]}</Markdown>
    </div>
  );
}

/** About Us: the client's title and tagline over the photograph of Jamaica's hills, then their text from about.md. */
export function AboutPage() {
  return (
    <>
      <section className="hills-backdrop -mt-16 text-white sm:-mt-[72px]">
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-32 pb-20 sm:px-8 sm:pt-44 sm:pb-28">
          <h2 className="font-serif text-[52px] leading-[1.05] font-normal tracking-[-0.0125em] sm:text-6xl lg:text-[72px]">About Us</h2>
          <p className="mt-6 max-w-2xl text-xl leading-[1.35] text-white/85 sm:text-2xl">
            Connecting Opportunities. Empowering Businesses. Building the Caribbean.
          </p>
        </div>
      </section>
      <article className="about-body mx-auto w-full max-w-3xl px-4 py-16 sm:px-8 sm:py-24">
        <Markdown>{about}</Markdown>
      </article>
    </>
  );
}

export const PrivacyPage = () => <InformationPage page="privacy" />;
export const TermsPage = () => <InformationPage page="terms" />;
