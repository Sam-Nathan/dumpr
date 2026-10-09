import { APP_STORE_URL, PLAY_STORE_URL } from '../config';

/** Store badges as text buttons. TODO: swap for the official badges + real listing URLs (see config.ts). */
export function StoreButtons({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <a href={PLAY_STORE_URL} className="btn-outline-on-ink" rel="noopener">
        <span className="text-[13px] font-medium opacity-80">Get it on</span> Google Play
      </a>
      <a href={APP_STORE_URL} className="btn-outline-on-ink" rel="noopener">
        <span className="text-[13px] font-medium opacity-80">Download on the</span> App Store
      </a>
    </div>
  );
}
