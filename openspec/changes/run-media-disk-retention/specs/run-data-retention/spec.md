## ADDED Requirements

### Requirement: Retention deletes run media wherever it is stored
The retention prune SHALL delete a run's uploaded participant media from every store the platform
writes it to, including the self-hosted server's disk, and SHALL report the media as purged only
when a store holding it was actually cleared.

#### Scenario: Media stored on the server disk
- **WHEN** a run whose media lives on the server disk reaches the end of its retention window
- **THEN** the prune removes that run's upload folder from the disk
- **AND** no other run's folder is touched

#### Scenario: No bucket exists
- **WHEN** the storage bucket call fails because the deployment has no bucket
- **THEN** the disk deletion still runs and the result reports the media as purged
