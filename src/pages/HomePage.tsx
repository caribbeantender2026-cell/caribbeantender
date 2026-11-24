/**
 * The public homepage: what the platform does, and buttons to sign up or sign in (PRD P1-12). Static:
 * visitors read no data. Layout, type and spacing follow harvey.ai, in CaribbeanTender's navy and gold.
 */
import { Link } from 'react-router';
import { ArrowRightIcon, CheckIcon } from 'lucide-react';
import { useAccount } from '../auth/AccountContext.tsx';
import { TenderDemo } from '../components/TenderDemo.tsx';
import { classNames } from '../lib/classNames.ts';
import cleaningPhoto from '../assets/photos/cleaning-office.webp';
import goodsPhoto from '../assets/photos/goods-warehouse.webp';
import professionalPhoto from '../assets/photos/professional-meeting.webp';
import securityPhoto from '../assets/photos/security-lobby.webp';
import signingPhoto from '../assets/photos/signing-contract.webp';
import technologyPhoto from '../assets/photos/technology-laptop.webp';
import worksPhoto from '../assets/photos/works-site.webp';

const container = 'mx-auto w-full max-w-[1440px] px-4 sm:px-8';
const sectionHeading = 'font-serif text-4xl leading-[1.1] font-normal tracking-[-0.01em] text-ink sm:text-5xl';

// Wording from the client's review (Rockell, 22 Nov 2026).
const audiences = [
  {
    title: 'For Businesses',
    headline: 'Find the Right Suppliers. Secure the Best Value.',
    text: 'Connect with qualified suppliers, receive competitive bids, and confidently select the best partner for your business needs.',
    points: [
      'Create and publish tenders anytime. Be sure to include clear requirements and supporting documents.',
      'Review proposals and award contracts to the most suitable suppliers.',
    ],
    action: { label: 'Post a Tender', signedInPath: '/business/tenders/new' },
    photo: professionalPhoto,
  },
  {
    title: 'For Suppliers',
    headline: 'Discover Opportunities. Grow Your Business.',
    text: 'Access contract opportunities across the Caribbean, connect with potential clients, and compete for projects that match your expertise.',
    points: [
      'Explore available tenders across different industries and service categories.',
      'Receive email alerts for new opportunities matching your business.',
      'Submit competitive bids and secure available contracts.',
    ],
    action: { label: 'Browse Open Tenders', signedInPath: '/tenders' },
    photo: goodsPhoto,
  },
];

// Six of the client's 66 categories (one tile each), matched to the photos; the full list is on the tenders page.
const categories = [
  { name: 'Warehousing & Distribution', photo: goodsPhoto },
  { name: 'Building & General Construction', photo: worksPhoto },
  { name: 'Business & Management Consulting', photo: professionalPhoto },
  { name: 'Information Technology', photo: technologyPhoto },
  { name: 'Security & Investigation Services', photo: securityPhoto },
  { name: 'Cleaning & Janitorial Services', photo: cleaningPhoto },
];

export function HomePage() {
  const { session } = useAccount();

  return (
    <>
      {/* Clipped sideways only: a vertical clip cut the bottom fade a pixel short of the edge at some zoom levels. */}
      <section className="hills-backdrop fades-to-paper -mt-16 overflow-x-clip text-white sm:-mt-[72px]">
        {/* The longer heading gets the wider column and a smaller size, so heading, demo steps and controls fit one screen. */}
        <div className={classNames(container, 'pt-24 sm:pt-[112px]')}>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-12">
            <h2 className="font-serif text-[40px] leading-[1.05] font-normal tracking-[-0.0125em] text-white sm:text-5xl lg:text-[58px]">Connecting Businesses to Opportunities</h2>
            <div className="lg:pt-2">
              <p className="max-w-[36rem] text-lg leading-[1.35] text-white/85 sm:text-xl">
                Caribbean Tender is an online procurement marketplace connecting businesses with qualified suppliers and enabling suppliers to compete for contract opportunities across the Caribbean.
              </p>
            </div>
          </div>
          <TenderDemo />
        </div>
      </section>

      <section className={classNames(container, 'pt-24 sm:pt-32')}>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className={sectionHeading}>One Platform. Endless Opportunities</h2>
          <p className="mt-4 text-lg leading-[1.4] text-ink/75">
            Businesses connect with qualified suppliers through competitive tendering, while suppliers discover new contract opportunities and compete for projects across the Caribbean.
          </p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {audiences.map(({ title, headline, text, points, action, photo }) => (
            <article key={title} className="overflow-hidden rounded-lg bg-midnight text-white">
              <img src={photo} alt="" width={1000} height={700} loading="lazy" className="aspect-[16/9] h-auto w-full object-cover" />
              <div className="p-8 sm:p-10">
                <h3 className="font-serif text-[32px] leading-[1.1] font-normal">{title}</h3>
                <p className="mt-3 text-lg font-medium text-white">{headline}</p>
                <p className="mt-2 text-white/75">{text}</p>
                <ul className="mt-6 space-y-2.5 text-sm text-white/85">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
                {/* Visitors sign up first; a signed-in person goes straight there (each page checks the account type). */}
                <Link to={session ? action.signedInPath : '/register'} className="mt-8 inline-flex rounded-button border border-white px-4 py-2.5 text-sm font-medium text-white no-underline transition-colors duration-150 hover:bg-white/10 hover:no-underline">
                  {action.label}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={classNames(container, 'pt-24 sm:pt-32')}>
        <h2 className={sectionHeading}>Tenders in Every Category</h2>
        <p className="mt-4 max-w-xl text-lg leading-[1.4] text-ink/75">Suppliers choose their category and get an email when a matching tender is posted.</p>
        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-3">
          {categories.map(({ name, photo }) => (
            <li key={name}>
              <Link to="/tenders" className="group block text-ink no-underline hover:no-underline">
                <span className="block overflow-hidden rounded-lg">
                  <img src={photo} alt="" width={1000} height={700} loading="lazy" className="aspect-[4/3] h-auto w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                </span>
                <span className="mt-3 flex items-center justify-between gap-2 text-sm font-medium sm:text-base">
                  {name}
                  <ArrowRightIcon className="size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-24 bg-[#eef1f5] py-20 sm:mt-32 sm:py-32">
        <div className={classNames(container, 'grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-8')}>
          <img src={signingPhoto} alt="A supplier signing a proposal." width={1600} height={1200} loading="lazy" className="aspect-square h-auto w-full rounded-lg object-cover" />
          <div className="lg:pl-8">
            <p className="font-serif text-3xl leading-[1.2] text-ink sm:text-[40px]">Secure and Confidential Bidding</p>
            <p className="mt-6 max-w-lg text-lg leading-[1.45] text-ink/75">
              All bid submissions are confidential and shared exclusively with the business (buyer). Bids remain securely sealed until the submission deadline, ensuring a fair and competitive procurement process.
            </p>
            <Link to="/about" className="group mt-8 inline-flex items-center gap-1.5 text-lg font-medium text-ink no-underline hover:no-underline">
              About CaribbeanTender
              <ArrowRightIcon className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
