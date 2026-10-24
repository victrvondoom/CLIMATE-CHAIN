import { TRACKS, type TrackId } from '../data/capabilities';

export function TrackBadges({ tracks, owner }: { tracks: TrackId[]; owner: string }) {
  return (
    <div className="capability-tracks" aria-label={`IEEE tracks for ${owner}`}>
      {tracks.map((id) => {
        const track = TRACKS.find((item) => item.id === id);
        return track ? <span className="capability-track" key={id} title={track.detail}>{track.label}</span> : null;
      })}
    </div>
  );
}
