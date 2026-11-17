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

const audiences = [
  {
    title: 'For Businesses',
    text: 'Post a tender, collect sealed bids, and award the best one.',
    points: ['Documents and a requirements form with every tender', 'Your own closing date and time', 'Every bid opened at once after closing'],
    photo: professionalPhoto,
  },
  {
    title: 'For Suppliers',
    text: 'Find work in your category and bid before the closing time.',
    points: ['Open tenders by category', 'Email alerts for new tenders in your category', 'A receipt for every bid you submit'],
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

const facts = [
  { label: 'Bids stay sealed until', value: 'the closing time' },
  { label: 'Every deadline is shown in', value: 'Jamaica time' },
  { label: 'Bid receipts are timestamped to', value: 'the second' },
];

export function HomePage() {
  const { session } = useAccount();
  const signUpPath = session ? '/tenders' : '/register';
  const signUpLabel = session ? 'Browse open tenders' : 'Sign up';

  return (
    <>
      <section className="hills-backdrop fades-to-paper -mt-16 overflow-hidden text-white sm:-mt-[72px]">
        <div className={classNames(container, 'pt-28 sm:pt-[136px]')}>
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
            <h2 className="font-serif text-[52px] leading-[1.05] font-normal tracking-[-0.0125em] text-white sm:text-6xl lg:text-[72px]">eTendering System</h2>
            <div className="lg:pt-4">
              <p className="max-w-[36rem] text-lg leading-[1.35] text-white/85 sm:text-xl">
                CaribbeanTender is a procurement platform where businesses publish tenders and suppliers submit sealed bids electronically.
              </p>
            </div>
          </div>
          <TenderDemo />
        </div>
      </section>

      <section className={classNames(container, 'pt-24 sm:pt-32')}>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className={sectionHeading}>One Platform for Buyers and Suppliers</h2>
          <p className="mt-4 text-lg leading-[1.4] text-ink/75">Businesses post tenders and award the best bid. Suppliers find work in their category and bid.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {audiences.map(({ title, text, points, photo }) => (
            <article key={title} className="overflow-hidden rounded-lg bg-midnight text-white">
              <img src={photo} alt="" width={1000} height={700} loading="lazy" className="aspect-[16/9] h-auto w-full object-cover" />
              <div className="p-8 sm:p-10">
                <h3 className="font-serif text-[32px] leading-[1.1] font-normal">{title}</h3>
                <p className="mt-3 text-white/75">{text}</p>
                <ul className="mt-6 space-y-2.5 text-sm text-white/85">
                  {points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
                <Link to={signUpPath} className="mt-8 inline-flex rounded-button border border-white px-4 py-2.5 text-sm font-medium text-white no-underline transition-colors duration-150 hover:bg-white/10 hover:no-underline">
                  {signUpLabel}
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
            <p className="font-serif text-3xl leading-[1.2] text-ink sm:text-[40px]">Nobody sees a bid before the closing time. Not even the business.</p>
            <p className="mt-6 max-w-lg text-lg leading-[1.45] text-ink/75">
              Every bid stays locked until the tender closes. Then the business sees all the bids at once and awards one.
            </p>
            <Link to="/about" className="group mt-8 inline-flex items-center gap-1.5 text-lg font-medium text-ink no-underline hover:no-underline">
              About CaribbeanTender
              <ArrowRightIcon className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-midnight text-white">
        <div className={classNames(container, 'pt-24 sm:pt-32')}>
          <dl className="border-y border-white/15">
            {facts.map(({ label, value }) => (
              <div key={label} className="grid gap-2 border-t border-white/15 py-8 first:border-t-0 md:grid-cols-2 md:items-center">
                <dt className="text-lg text-white/80 sm:text-xl">{label}</dt>
                <dd className="font-serif text-4xl leading-none tracking-[-0.02em] sm:text-[64px]">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-6 border-b border-white/15 py-20 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-serif text-3xl leading-[1.15] font-normal sm:text-[32px]">Ready for Your Next Tender?</h2>
            <Link to={signUpPath} className="inline-flex self-start rounded-button bg-white px-5 py-3 text-base font-medium text-ink no-underline transition-colors duration-150 hover:bg-white/90 hover:no-underline">
              {signUpLabel}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
