# seo-landing-pages Specification (delta)

## MODIFIED Requirements

### Requirement: Landing pages are linked, not orphaned

Every landing page SHALL contain at least one link into the application, so a visitor who
arrives from search can act. Every landing page SHALL contain at least one link to another
landing page, so the set is internally connected rather than a collection of dead ends.

The application SHALL link outward to landing pages from a surface reachable without
authentication, so the pages accumulate internal links.

Every landing page SHALL additionally link to the marketing site, and the marketing site
SHALL link back to at least one landing page. Without this the two sets are two islands:
each internally connected, neither reachable from the other, and neither passing any
signal to the other. The link SHALL be to a page that exists in the same language as the
landing page carrying it, so a Hebrew reader is not handed an English destination.

#### Scenario: Each page offers a way into the product

- **WHEN** a landing page's links are enumerated
- **THEN** at least one link targets the application

#### Scenario: Each page links onward to a sibling

- **WHEN** a landing page's links are enumerated
- **THEN** at least one link targets another landing page

#### Scenario: The app links out to the pages

- **WHEN** the unauthenticated landing surface of the creator console is inspected
- **THEN** it links to at least one landing page

#### Scenario: Each page links to the marketing site in its own language

- **WHEN** a landing page's links are enumerated
- **THEN** at least one link targets a marketing site page declaring the same language as the landing page

#### Scenario: The marketing site links back

- **WHEN** the marketing site's links are enumerated
- **THEN** at least one targets a landing page
