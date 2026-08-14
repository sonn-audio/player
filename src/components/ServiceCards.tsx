/**
 * The top of the catalogue: the providers themselves.
 *
 * Same disease as a service root, one level up — five browsable, coverless items, drawn by the
 * artwork grid as five empty sleeves. But the cure is different here, and it is worth being
 * precise about why: a service *has* no contents to borrow a picture from. Ask Spotify for its
 * first four children and you get four more folders with no artwork, so a mosaic would resolve to
 * the same grey square it was meant to replace.
 *
 * What a service does have is a mark. So this is the one place in the browser that draws brand
 * rather than music — a logo is recognised before it is read, which is exactly what you want from
 * a row of five doorways you pick between constantly.
 *
 * The count underneath is the folder's own `total`, and it is shared with the shelves: opening a
 * service a moment later reuses the listing this asked for rather than requesting it again.
 */
import { Icon } from '@/components/Icon';
import { serviceLogoUrl } from '@/components/ServiceBadge';
import { useFolderPreview } from '@/state/useFolderPreview';
import type { ContentItem } from '@/api/content';

/** Only the count is wanted here, and one item is the cheapest way a provider will report it. */
const PROBE = 1;

export function ServiceCards({
  services,
  serviceNames,
  onOpen,
}: {
  services: ContentItem[];
  serviceNames: Record<string, string>;
  onOpen: (item: ContentItem) => void;
}) {
  return (
    <ul className="service-cards">
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          item={service}
          label={serviceNames[service.service] ?? service.name}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}

function ServiceCard({
  item,
  label,
  onOpen,
}: {
  item: ContentItem;
  label: string;
  onOpen: (item: ContentItem) => void;
}) {
  const preview = useFolderPreview(item.id, PROBE);
  const logo = serviceLogoUrl(item.service);

  return (
    <li>
      <button type="button" className="service-card" onClick={() => onOpen(item)}>
        <span className="service-card-plate">
          {logo ? (
            <img src={logo} alt="" width={26} height={26} decoding="async" />
          ) : (
            /* A provider with no mark of its own — the library, the radio directory. Its initial
               in the display face, which is a considered answer rather than a missing image. */
            <span className="service-card-letter disp" aria-hidden="true">
              {label.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
        <span className="service-card-text">
          <span className="service-card-name">{label}</span>
          {preview.total !== null && preview.state === 'ready' && (
            <span className="service-card-count">
              {preview.total} {preview.total === 1 ? 'collection' : 'collections'}
            </span>
          )}
        </span>
        <Icon name="chevron-right" className="service-card-go" />
      </button>
    </li>
  );
}
