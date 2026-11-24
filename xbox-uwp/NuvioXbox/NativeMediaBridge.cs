using System;
using System.Collections.Generic;
using System.Diagnostics;
using Windows.Data.Json;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace NuvioXbox
{
    internal sealed class NativeMediaBridge : IDisposable
    {
        private readonly MediaPlayerElement playerElement;
        private readonly MediaPlayer mediaPlayer;
        private readonly CoreDispatcher dispatcher;
        private readonly Action<JsonObject> postEvent;
        private readonly Action<bool> setUnderlayVisible;
        private readonly DispatcherTimer positionTimer;

        private MediaPlaybackItem currentItem;
        private string pendingUrl = string.Empty;
        private bool isPrepared = false;

        public NativeMediaBridge(
            MediaPlayerElement element,
            Action<JsonObject> postEventCallback,
            Action<bool> setUnderlayVisibleCallback)
        {
            playerElement = element;
            dispatcher = element.Dispatcher;
            postEvent = postEventCallback;
            setUnderlayVisible = setUnderlayVisibleCallback;

            mediaPlayer = new MediaPlayer
            {
                AutoPlay = false
            };
            mediaPlayer.CommandManager.IsEnabled = false;
            playerElement.SetMediaPlayer(mediaPlayer);

            mediaPlayer.MediaOpened += OnMediaOpened;
            mediaPlayer.MediaEnded += OnMediaEnded;
            mediaPlayer.MediaFailed += OnMediaFailed;
            mediaPlayer.PlaybackSession.BufferingStarted += OnBufferingStarted;
            mediaPlayer.PlaybackSession.BufferingEnded += OnBufferingEnded;
            mediaPlayer.PlaybackSession.BufferingProgressChanged += OnBufferingProgressChanged;
            mediaPlayer.PlaybackSession.PlaybackStateChanged += OnPlaybackStateChanged;
            mediaPlayer.PlaybackSession.SeekCompleted += OnSeekCompleted;

            positionTimer = new DispatcherTimer
            {
                Interval = TimeSpan.FromMilliseconds(250)
            };
            positionTimer.Tick += OnPositionTimerTick;
        }

        public void HandleCommand(JsonObject json)
        {
            string command = json.ContainsKey("command") ? json.GetNamedString("command") : string.Empty;
            switch (command)
            {
                case "open":
                    Open(json.ContainsKey("url") ? json.GetNamedString("url") : string.Empty);
                    break;
                case "prepare":
                    Prepare(json);
                    break;
                case "play":
                    Play();
                    break;
                case "pause":
                    Pause();
                    break;
                case "stop":
                    Stop();
                    break;
                case "close":
                    Close();
                    break;
                case "seekTo":
                    double positionMs = json.ContainsKey("positionMs") ? json.GetNamedNumber("positionMs") : 0;
                    SeekTo(positionMs);
                    break;
                case "setSpeed":
                    double rate = json.ContainsKey("rate") ? json.GetNamedNumber("rate") : 1.0;
                    SetSpeed(rate);
                    break;
                case "setSelectTrack":
                    string trackType = json.ContainsKey("trackType") ? json.GetNamedString("trackType") : string.Empty;
                    int index = json.ContainsKey("index") ? (int)json.GetNamedNumber("index") : -1;
                    SetSelectTrack(trackType, index);
                    break;
                case "setDisplayMethod":
                    string mode = json.ContainsKey("mode") ? json.GetNamedString("mode") : string.Empty;
                    SetDisplayMethod(mode);
                    break;
            }
        }

        private void Open(string url)
        {
            ResetPlayback();
            pendingUrl = url ?? string.Empty;
            setUnderlayVisible?.Invoke(true);
        }

        private void Prepare(JsonObject json)
        {
            string url = json.ContainsKey("url") ? json.GetNamedString("url") : pendingUrl;
            if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out Uri uri))
            {
                EmitEvent("prepareError", evt => evt.SetNamedValue("error", JsonValue.CreateStringValue("Invalid media URL")));
                return;
            }

            try
            {
                isPrepared = false;
                var source = MediaSource.CreateFromUri(uri);
                currentItem = new MediaPlaybackItem(source);
                currentItem.AudioTracksChanged += OnAudioTracksChanged;
                mediaPlayer.Source = currentItem;
            }
            catch (Exception ex)
            {
                EmitEvent("prepareError", evt => evt.SetNamedValue("error", JsonValue.CreateStringValue(ex.Message)));
            }
        }

        private void Play()
        {
            try
            {
                setUnderlayVisible?.Invoke(true);
                mediaPlayer.Play();
                positionTimer.Start();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"NativeMediaBridge Play failed: {ex.Message}");
            }
        }

        private void Pause()
        {
            try
            {
                mediaPlayer.Pause();
                positionTimer.Stop();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"NativeMediaBridge Pause failed: {ex.Message}");
            }
        }

        private void Stop()
        {
            ResetPlayback();
        }

        private void Close()
        {
            ResetPlayback();
            setUnderlayVisible?.Invoke(false);
        }

        private void ResetPlayback()
        {
            positionTimer.Stop();
            isPrepared = false;
            if (currentItem != null)
            {
                currentItem.AudioTracksChanged -= OnAudioTracksChanged;
                currentItem = null;
            }
            mediaPlayer.Source = null;
        }

        private void SeekTo(double positionMs)
        {
            try
            {
                var session = mediaPlayer.PlaybackSession;
                if (session != null && session.CanSeek)
                {
                    session.Position = TimeSpan.FromMilliseconds(Math.Max(0, positionMs));
                }
                else
                {
                    EmitEvent("seekCompleted");
                }
            }
            catch (Exception ex)
            {
                EmitEvent("seekFailed", evt => evt.SetNamedValue("error", JsonValue.CreateStringValue(ex.Message)));
            }
        }

        private void SetSpeed(double rate)
        {
            try
            {
                if (mediaPlayer.PlaybackSession != null && rate > 0)
                {
                    mediaPlayer.PlaybackSession.PlaybackRate = rate;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"NativeMediaBridge SetSpeed failed: {ex.Message}");
            }
        }

        private void SetSelectTrack(string trackType, int index)
        {
            if (currentItem == null || !string.Equals(trackType, "AUDIO", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            try
            {
                if (index >= 0 && index < currentItem.AudioTracks.Count)
                {
                    currentItem.AudioTracks.SelectedIndex = index;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"NativeMediaBridge SetSelectTrack failed: {ex.Message}");
            }
        }

        private void SetDisplayMethod(string mode)
        {
            playerElement.Stretch = mode switch
            {
                "PLAYER_DISPLAY_MODE_FULL_SCREEN" => Stretch.UniformToFill,
                "PLAYER_DISPLAY_MODE_AUTO_SELECT" => Stretch.Uniform,
                _ => Stretch.Uniform
            };
        }

        private void OnMediaOpened(MediaPlayer sender, object args)
        {
            RunOnUiThread(() =>
            {
                isPrepared = true;
                EmitEvent("prepared", evt =>
                {
                    double durationMs = sender.PlaybackSession?.NaturalDuration.TotalMilliseconds ?? 0;
                    evt.SetNamedValue("durationMs", JsonValue.CreateNumberValue(Math.Max(0, durationMs)));
                    evt.SetNamedValue("tracks", BuildTrackInfoJson());
                });
            });
        }

        private void OnAudioTracksChanged(MediaPlaybackItem sender, Windows.Foundation.Collections.IVectorChangedEventArgs args)
        {
            RunOnUiThread(() =>
            {
                if (isPrepared)
                {
                    EmitEvent("stateChanged", evt =>
                    {
                        evt.SetNamedValue("tracks", BuildTrackInfoJson());
                    });
                }
            });
        }

        private void OnMediaEnded(MediaPlayer sender, object args)
        {
            RunOnUiThread(() =>
            {
                positionTimer.Stop();
                EmitEvent("ended");
            });
        }

        private void OnMediaFailed(MediaPlayer sender, MediaPlayerFailedEventArgs args)
        {
            RunOnUiThread(() =>
            {
                positionTimer.Stop();
                string message = $"PLAYER_ERROR_{args.Error}: {args.ErrorMessage}";
                EmitEvent("error", evt => evt.SetNamedValue("error", JsonValue.CreateStringValue(message)));
            });
        }

        private void OnBufferingStarted(MediaPlaybackSession sender, object args)
        {
            RunOnUiThread(() => EmitEvent("bufferingStart"));
        }

        private void OnBufferingProgressChanged(MediaPlaybackSession sender, object args)
        {
            RunOnUiThread(() =>
            {
                EmitEvent("bufferingProgress", evt =>
                {
                    evt.SetNamedValue("percent", JsonValue.CreateNumberValue(Math.Round(sender.BufferingProgress * 100.0)));
                });
            });
        }

        private void OnBufferingEnded(MediaPlaybackSession sender, object args)
        {
            RunOnUiThread(() => EmitEvent("bufferingComplete"));
        }

        private void OnPlaybackStateChanged(MediaPlaybackSession sender, object args)
        {
            RunOnUiThread(() =>
            {
                string mapped = sender.PlaybackState switch
                {
                    MediaPlaybackState.Playing => "PLAYING",
                    MediaPlaybackState.Paused => "PAUSED",
                    MediaPlaybackState.Opening => "IDLE",
                    MediaPlaybackState.Buffering => "PLAYING",
                    _ => "READY"
                };
                EmitEvent("stateChanged", evt => evt.SetNamedValue("state", JsonValue.CreateStringValue(mapped)));
            });
        }

        private void OnSeekCompleted(MediaPlaybackSession sender, object args)
        {
            RunOnUiThread(() =>
            {
                double currentMs = sender.Position.TotalMilliseconds;
                EmitEvent("seekCompleted", evt => evt.SetNamedValue("currentTimeMs", JsonValue.CreateNumberValue(Math.Max(0, currentMs))));
            });
        }

        private void OnPositionTimerTick(object sender, object e)
        {
            var session = mediaPlayer.PlaybackSession;
            if (session == null)
            {
                return;
            }
            double currentMs = session.Position.TotalMilliseconds;
            double durationMs = session.NaturalDuration.TotalMilliseconds;
            EmitEvent("timeupdate", evt =>
            {
                evt.SetNamedValue("currentTimeMs", JsonValue.CreateNumberValue(Math.Max(0, currentMs)));
                if (durationMs > 0)
                {
                    evt.SetNamedValue("durationMs", JsonValue.CreateNumberValue(durationMs));
                }
            });
        }

        private JsonArray BuildTrackInfoJson()
        {
            var tracks = new JsonArray();
            if (currentItem == null)
            {
                return tracks;
            }

            int selectedAudio = currentItem.AudioTracks.SelectedIndex;
            for (int i = 0; i < currentItem.AudioTracks.Count; i++)
            {
                var audio = currentItem.AudioTracks[i];
                var extra = new JsonObject();
                extra.SetNamedValue("language", JsonValue.CreateStringValue(audio.Language ?? string.Empty));
                extra.SetNamedValue("channels", JsonValue.CreateNumberValue(audio.GetEncodingProperties()?.ChannelCount ?? 0));
                extra.SetNamedValue("codec", JsonValue.CreateStringValue(audio.GetEncodingProperties()?.Subtype ?? string.Empty));

                var entry = new JsonObject();
                entry.SetNamedValue("type", JsonValue.CreateStringValue("AUDIO"));
                entry.SetNamedValue("index", JsonValue.CreateNumberValue(i));
                entry.SetNamedValue("language", JsonValue.CreateStringValue(audio.Language ?? string.Empty));
                entry.SetNamedValue("label", JsonValue.CreateStringValue(string.IsNullOrWhiteSpace(audio.Label) ? $"Audio {i + 1}" : audio.Label));
                entry.SetNamedValue("name", JsonValue.CreateStringValue(string.IsNullOrWhiteSpace(audio.Name) ? audio.Label ?? string.Empty : audio.Name));
                entry.SetNamedValue("selected", JsonValue.CreateBooleanValue(i == selectedAudio));
                entry.SetNamedValue("extra_info", extra);
                tracks.Add(entry);
            }

            return tracks;
        }

        private void EmitEvent(string eventName, Action<JsonObject> populate = null)
        {
            var payload = new JsonObject();
            payload.SetNamedValue("type", JsonValue.CreateStringValue("xbox-player-event"));
            payload.SetNamedValue("event", JsonValue.CreateStringValue(eventName));
            populate?.Invoke(payload);
            postEvent?.Invoke(payload);
        }

        private async void RunOnUiThread(Action action)
        {
            if (dispatcher.HasThreadAccess)
            {
                action();
                return;
            }
            await dispatcher.RunAsync(CoreDispatcherPriority.Normal, () => action());
        }

        public void Dispose()
        {
            positionTimer.Stop();
            mediaPlayer.MediaOpened -= OnMediaOpened;
            mediaPlayer.MediaEnded -= OnMediaEnded;
            mediaPlayer.MediaFailed -= OnMediaFailed;
            mediaPlayer.PlaybackSession.BufferingStarted -= OnBufferingStarted;
            mediaPlayer.PlaybackSession.BufferingEnded -= OnBufferingEnded;
            mediaPlayer.PlaybackSession.BufferingProgressChanged -= OnBufferingProgressChanged;
            mediaPlayer.PlaybackSession.PlaybackStateChanged -= OnPlaybackStateChanged;
            mediaPlayer.PlaybackSession.SeekCompleted -= OnSeekCompleted;
            ResetPlayback();
            mediaPlayer.Dispose();
        }
    }
}
