import {
  pickTitleSize,
  pickToolTitleSize,
  pickPreviewValueSize,
  truncate,
} from './og-helpers.mjs'

// Brand palette — pulled from public/runcycles-og.svg and public/runcycles-logo.svg.
// Amber matches the calculator's in-app "biggest monthly radius" highlight
// (#d97706); used here for the tool-template pill so it reads against the
// teal value instead of blending in.
//
// cardBorder is intentionally a solid hex rather than rgba — JPEG-ish
// transcoding by LinkedIn/Slack/Discord washes out subtle alpha borders;
// a solid grey one step brighter than bg survives the recompression.
export const BRAND = {
  bg: '#1B1B1F',
  divider: '#3C3C43',
  cardBorder: '#2C2C33',
  teal: '#00C9A7',
  amber: '#F59E0B',
  textPrimary: '#FFFFFF',
  textSecondary: '#AEAEB2',
  textMuted: '#8E8E93',
}

function el(type, style, children) {
  return { type, props: { style, children } }
}

function img(src, width, height) {
  return { type: 'img', props: { src, width, height, style: { width, height } } }
}

function header(logoDataUri) {
  return el(
    'div',
    { display: 'flex', alignItems: 'center', gap: '18px' },
    [
      img(logoDataUri, 64, 64),
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: '44px',
          letterSpacing: '-0.02em',
          color: BRAND.textPrimary,
        },
        'Cycles',
      ),
    ],
  )
}

function divider() {
  return el('div', {
    marginTop: '24px',
    width: '100%',
    height: '1px',
    background: BRAND.divider,
  })
}

function topAccentBar() {
  return el('div', {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '1200px',
    height: '3px',
    background: BRAND.teal,
    opacity: 0.6,
  })
}

function tealAccentBar() {
  return el('div', {
    width: '72px',
    height: '4px',
    background: BRAND.teal,
    marginBottom: '28px',
  })
}

function frame(children) {
  return el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: '1200px',
      height: '630px',
      background: BRAND.bg,
      padding: '56px 64px',
      fontFamily: 'Inter',
      color: BRAND.textPrimary,
      position: 'relative',
    },
    children,
  )
}

function tagChip(label) {
  return el(
    'div',
    {
      display: 'flex',
      alignItems: 'center',
      height: '36px',
      padding: '0 18px',
      borderRadius: '18px',
      background: 'rgba(0, 201, 167, 0.12)',
      border: '1px solid rgba(0, 201, 167, 0.4)',
      color: BRAND.teal,
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: '15px',
      letterSpacing: '0.01em',
      marginRight: '12px',
    },
    label,
  )
}

export function blogTree({ title, date, author, tags, logoDataUri }) {
  const titleSize = pickTitleSize(title, false)
  const visibleTags = (Array.isArray(tags) ? tags : []).slice(0, 4)

  const titleBlockChildren = [
    tealAccentBar(),
    el(
      'div',
      {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: `${titleSize}px`,
        lineHeight: 1.15,
        letterSpacing: '-0.02em',
        color: BRAND.textPrimary,
      },
      title,
    ),
  ]
  if (visibleTags.length > 0) {
    titleBlockChildren.push(
      el(
        'div',
        { display: 'flex', flexWrap: 'wrap', marginTop: '28px' },
        visibleTags.map((t) => tagChip(`#${t}`)),
      ),
    )
  }

  return frame([
    topAccentBar(),
    header(logoDataUri),
    divider(),
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
        maxWidth: '1072px',
      },
      titleBlockChildren,
    ),
    el(
      'div',
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      [
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: '22px',
            color: BRAND.textSecondary,
          },
          `${date}  ·  ${author}`,
        ),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: '22px',
            color: BRAND.textMuted,
          },
          'runcycles.io',
        ),
      ],
    ),
  ])
}

export function docsTree({ title, description, section, logoDataUri }) {
  const desc = truncate(description, 160)
  const titleSize = pickTitleSize(title, !!desc)

  const bodyChildren = []
  if (section) {
    bodyChildren.push(
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: '16px',
          letterSpacing: '0.18em',
          color: BRAND.teal,
          textTransform: 'uppercase',
          marginBottom: '20px',
        },
        section.toUpperCase(),
      ),
    )
  }
  bodyChildren.push(tealAccentBar())
  bodyChildren.push(
    el(
      'div',
      {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: `${titleSize}px`,
        lineHeight: 1.15,
        letterSpacing: '-0.02em',
        color: BRAND.textPrimary,
      },
      title,
    ),
  )
  if (desc) {
    bodyChildren.push(
      el(
        'div',
        {
          marginTop: '20px',
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: '24px',
          lineHeight: 1.4,
          color: BRAND.textSecondary,
          maxHeight: '70px',
          overflow: 'hidden',
        },
        desc,
      ),
    )
  }

  return frame([
    topAccentBar(),
    header(logoDataUri),
    divider(),
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        justifyContent: 'center',
        maxWidth: '1072px',
      },
      bodyChildren,
    ),
    el(
      'div',
      { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' },
      [
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: '22px',
            color: BRAND.textMuted,
          },
          'runcycles.io',
        ),
      ],
    ),
  ])
}

// Tool template — for calculator/demo pages where the OG image should preview
// the actual output, not just restate the title and meta-description.
//
// Layout: left column = eyebrow + title + one-line hook. Right column =
// preview card with optional pill (e.g. "×14"), big value (e.g. "$342K"),
// and a label (e.g. "monthly blast radius").
//
// Description is dropped on purpose — it's already rendered as og:description
// below the card by the social embed, so repeating it on the image is dead
// weight. The hook replaces it as something that converts on a glance.
export function toolTree({ title, section, hook, preview, logoDataUri }) {
  const titleSize = pickToolTitleSize(title)
  const valueSize = pickPreviewValueSize(preview.value)

  const leftChildren = []
  if (section) {
    leftChildren.push(
      el(
        'div',
        {
          display: 'flex',
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: '16px',
          letterSpacing: '0.18em',
          color: BRAND.teal,
          textTransform: 'uppercase',
          marginBottom: '20px',
        },
        section.toUpperCase(),
      ),
    )
  }
  leftChildren.push(tealAccentBar())
  leftChildren.push(
    el(
      'div',
      {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: `${titleSize}px`,
        lineHeight: 1.1,
        letterSpacing: '-0.02em',
        color: BRAND.textPrimary,
      },
      title,
    ),
  )
  if (hook) {
    leftChildren.push(
      el(
        'div',
        {
          // Title-to-hook gap was visibly tighter than eyebrow-to-title; this
          // brings the rhythm closer to a consistent baseline.
          marginTop: '36px',
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: '22px',
          lineHeight: 1.4,
          color: BRAND.textSecondary,
        },
        truncate(hook, 110),
      ),
    )
  }

  const cardChildren = []
  if (preview.pill) {
    // Pill + optional caption stack right-aligned in the upper card. The
    // number alone (×14, 24×) is opaque at thumbnail size; the caption tells
    // someone who hasn't read the page what the multiplier represents.
    const pillStack = [
      el(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          height: '40px',
          padding: '0 18px',
          borderRadius: '20px',
          background: 'rgba(245, 158, 11, 0.18)',
          border: '1px solid rgba(245, 158, 11, 0.55)',
          color: BRAND.amber,
          fontFamily: 'Inter',
          fontWeight: 700,
          fontSize: '20px',
          letterSpacing: '0.01em',
        },
        preview.pill,
      ),
    ]
    if (preview.pillCaption) {
      pillStack.push(
        el(
          'div',
          {
            marginTop: '6px',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontSize: '13px',
            letterSpacing: '0.18em',
            color: BRAND.amber,
            textTransform: 'uppercase',
          },
          preview.pillCaption,
        ),
      )
    }
    cardChildren.push(
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          alignSelf: 'flex-end',
          alignItems: 'flex-end',
          marginBottom: '14px',
        },
        pillStack,
      ),
    )
  }
  cardChildren.push(
    el(
      'div',
      {
        fontFamily: 'Inter',
        fontWeight: 700,
        fontSize: `${valueSize}px`,
        lineHeight: 1,
        letterSpacing: '-0.03em',
        color: BRAND.teal,
      },
      preview.value,
    ),
  )
  cardChildren.push(
    el(
      'div',
      {
        marginTop: '16px',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSize: '20px',
        lineHeight: 1.3,
        color: BRAND.textSecondary,
        maxWidth: '380px',
      },
      preview.label,
    ),
  )

  const previewCard = el(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: '440px',
      padding: '36px 40px',
      borderRadius: '16px',
      background: 'rgba(0, 201, 167, 0.06)',
      border: `1px solid ${BRAND.cardBorder}`,
    },
    cardChildren,
  )

  return frame([
    topAccentBar(),
    header(logoDataUri),
    divider(),
    el(
      'div',
      {
        display: 'flex',
        flexDirection: 'row',
        flex: 1,
        alignItems: 'center',
        gap: '40px',
      },
      [
        el(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            width: '600px',
          },
          leftChildren,
        ),
        previewCard,
      ],
    ),
    el(
      'div',
      { display: 'flex', justifyContent: 'flex-end', alignItems: 'center' },
      [
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: '22px',
            color: BRAND.textMuted,
          },
          'runcycles.io',
        ),
      ],
    ),
  ])
}
