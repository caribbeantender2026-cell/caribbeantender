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

export const AboutPage = () => <InformationPage page="about" />;
export const PrivacyPage = () => <InformationPage page="privacy" />;
export const TermsPage = () => <InformationPage page="terms" />;
