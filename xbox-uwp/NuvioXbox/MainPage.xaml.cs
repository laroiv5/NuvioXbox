using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using System;
using System.Diagnostics;
using Windows.Data.Json;
using Windows.Media;
using Windows.System;
using Windows.System.Display;
using Windows.UI;
using Windows.UI.Core;
using Windows.UI.ViewManagement;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace NuvioXbox
{
    public sealed partial class MainPage : Page
    {
        private const string InitialUri = "https://nuvio.xbox.local/index.html?platform=xbox";

        private WebView2 webView;
        private SystemMediaTransportControls smtc;
        private DisplayRequest displayRequest;
        private bool isDisplayRequestActive = false;
        private bool isNavigatedToPage = false;
        private NativeMediaBridge nativeMediaBridge;

        public MainPage()
        {
            this.InitializeComponent();

            ApplicationView.GetForCurrentView().SetDesiredBoundsMode(ApplicationViewBoundsMode.UseCoreWindow);

            SystemNavigationManager.GetForCurrentView().BackRequested += OnBackRequested;

            smtc = SystemMediaTransportControls.GetForCurrentView();
            smtc.IsEnabled = true;
            smtc.IsPlayEnabled = true;
            smtc.IsPauseEnabled = true;
            smtc.IsStopEnabled = true;
            smtc.IsNextEnabled = true;
            smtc.IsPreviousEnabled = true;
            smtc.IsFastForwardEnabled = true;
            smtc.IsRewindEnabled = true;
            smtc.ButtonPressed += OnSmtcButtonPressed;

            displayRequest = new DisplayRequest();
            nativeMediaBridge = new NativeMediaBridge(NativePlayer, PostJsonToWebView, SetUnderlayVisible);

            InitializeWebViewAsync();
        }

        private async void InitializeWebViewAsync()
        {
            webView = new WebView2();
            webView.Background = new Windows.UI.Xaml.Media.SolidColorBrush(Colors.Transparent);
            webView.HorizontalAlignment = HorizontalAlignment.Stretch;
            webView.VerticalAlignment = VerticalAlignment.Stretch;

            await webView.EnsureCoreWebView2Async();
            var coreWV2 = webView.CoreWebView2;

            WebContainer.Children.Clear();
            WebContainer.Children.Add(webView);
            webView.Focus(FocusState.Programmatic);

            if (coreWV2 == null)
            {
                Debug.WriteLine("Unable to initialize CoreWebView2.");
                return;
            }

            coreWV2.Settings.AreDefaultContextMenusEnabled = false;
            coreWV2.Settings.IsGeneralAutofillEnabled = false;
            coreWV2.Settings.IsPasswordAutosaveEnabled = false;
            coreWV2.Settings.IsStatusBarEnabled = false;
            coreWV2.Settings.IsReputationCheckingRequired = false;
            coreWV2.Settings.AreDevToolsEnabled = false;

            coreWV2.SetVirtualHostNameToFolderMapping(
                "nuvio.xbox.local",
                "WebCode",
                CoreWebView2HostResourceAccessKind.Allow
            );

            await coreWV2.AddScriptToExecuteOnDocumentCreatedAsync(
                "(() => {" +
                "  window.__NUVIO_XBOX_HOST__ = true;" +
                "  window.__NUVIO_PLATFORM__ = 'xbox';" +
                "})();"
            );

            webView.WebMessageReceived += OnWebMessageReceived;
            webView.NavigationStarting += OnNavigationStarting;
            webView.NavigationCompleted += OnNavigationCompleted;
            coreWV2.ProcessFailed += OnWebViewProcessFailed;
            coreWV2.LaunchingExternalUriScheme += OnLaunchingExternalUriScheme;

            webView.Source = new Uri(InitialUri);
        }

        private void OnNavigationStarting(WebView2 sender, CoreWebView2NavigationStartingEventArgs args)
        {
            isNavigatedToPage = false;
        }

        private void OnNavigationCompleted(WebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
        {
            LoadingOverlay.Visibility = Visibility.Collapsed;
            if (args.IsSuccess)
            {
                isNavigatedToPage = true;
                webView?.Focus(FocusState.Programmatic);
            }
            else
            {
                Debug.WriteLine($"WebView navigation failed: {args.WebErrorStatus}");
            }
        }

        private void OnBackRequested(object sender, BackRequestedEventArgs e)
        {
            // Never allow B-button back navigation to terminate the Xbox app prematurely.
            e.Handled = true;
            var payload = new JsonObject();
            payload.SetNamedValue("type", JsonValue.CreateStringValue("xbox-back"));
            PostJsonToWebView(payload);
        }

        private void OnWebMessageReceived(WebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            string raw = args.TryGetWebMessageAsString();
            if (!JsonObject.TryParse(raw, out JsonObject json))
            {
                return;
            }

            string messageType = json.ContainsKey("type") ? json.GetNamedString("type") : string.Empty;
            switch (messageType)
            {
                case "ExitApp":
                    SetKeepScreenOn(false);
                    nativeMediaBridge?.Dispose();
                    Application.Current.Exit();
                    break;

                case "SetUnderlayActive":
                    bool active = json.ContainsKey("active") && json.GetNamedBoolean("active");
                    SetUnderlayVisible(active);
                    break;

                case "PlaybackState":
                    HandlePlaybackStateMessage(json);
                    break;

                case "AvPlayCommand":
                    nativeMediaBridge?.HandleCommand(json);
                    break;
            }
        }

        private void SetUnderlayVisible(bool active)
        {
            NativePlayer.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
            WebBackdrop.Visibility = active ? Visibility.Collapsed : Visibility.Visible;
        }

        private void HandlePlaybackStateMessage(JsonObject json)
        {
            string status = json.ContainsKey("status") ? json.GetNamedString("status") : "stopped";
            double currentTime = json.ContainsKey("currentTime") ? json.GetNamedNumber("currentTime") : 0;
            double duration = json.ContainsKey("duration") ? json.GetNamedNumber("duration") : 0;
            string title = json.ContainsKey("title") ? json.GetNamedString("title") : string.Empty;
            string subtitle = json.ContainsKey("subtitle") ? json.GetNamedString("subtitle") : string.Empty;

            if (status == "playing")
            {
                smtc.PlaybackStatus = MediaPlaybackStatus.Playing;
                SetKeepScreenOn(true);
            }
            else if (status == "paused")
            {
                smtc.PlaybackStatus = MediaPlaybackStatus.Paused;
                SetKeepScreenOn(false);
            }
            else
            {
                smtc.PlaybackStatus = MediaPlaybackStatus.Stopped;
                SetKeepScreenOn(false);
            }

            if (duration > 0)
            {
                smtc.UpdateTimelineProperties(new SystemMediaTransportControlsTimelineProperties
                {
                    StartTime = TimeSpan.Zero,
                    MinSeekTime = TimeSpan.Zero,
                    Position = TimeSpan.FromSeconds(Math.Max(0, currentTime)),
                    MaxSeekTime = TimeSpan.FromSeconds(Math.Max(0, duration)),
                    EndTime = TimeSpan.FromSeconds(Math.Max(0, duration))
                });
            }

            if (!string.IsNullOrEmpty(title))
            {
                var updater = smtc.DisplayUpdater;
                updater.Type = MediaPlaybackType.Video;
                updater.VideoProperties.Title = title;
                updater.VideoProperties.Subtitle = subtitle;
                updater.Update();
            }
        }

        private void SetKeepScreenOn(bool keepOn)
        {
            if (displayRequest == null)
            {
                return;
            }

            try
            {
                if (keepOn && !isDisplayRequestActive)
                {
                    displayRequest.RequestActive();
                    isDisplayRequestActive = true;
                }
                else if (!keepOn && isDisplayRequestActive)
                {
                    displayRequest.RequestRelease();
                    isDisplayRequestActive = false;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DisplayRequest error: {ex.Message}");
            }
        }

        private async void OnSmtcButtonPressed(
            SystemMediaTransportControls sender,
            SystemMediaTransportControlsButtonPressedEventArgs args)
        {
            await Dispatcher.RunAsync(CoreDispatcherPriority.Normal, () =>
            {
                if (!isNavigatedToPage)
                {
                    return;
                }

                string action = args.Button switch
                {
                    SystemMediaTransportControlsButton.Play => "play",
                    SystemMediaTransportControlsButton.Pause => "pause",
                    SystemMediaTransportControlsButton.Stop => "stop",
                    SystemMediaTransportControlsButton.Next => "next",
                    SystemMediaTransportControlsButton.Previous => "previous",
                    SystemMediaTransportControlsButton.FastForward => "fastforward",
                    SystemMediaTransportControlsButton.Rewind => "rewind",
                    _ => string.Empty
                };

                if (!string.IsNullOrEmpty(action))
                {
                    var payload = new JsonObject();
                    payload.SetNamedValue("type", JsonValue.CreateStringValue("xbox-smtc"));
                    payload.SetNamedValue("action", JsonValue.CreateStringValue(action));
                    PostJsonToWebView(payload);
                }
            });
        }

        private async void OnLaunchingExternalUriScheme(
            CoreWebView2 sender,
            CoreWebView2LaunchingExternalUriSchemeEventArgs args)
        {
            args.Cancel = true;
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out Uri externalUri))
            {
                await Launcher.LaunchUriAsync(externalUri);
            }
        }

        private void OnWebViewProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs args)
        {
            Debug.WriteLine($"WebView2 process failed: {args.ProcessFailedKind} ({args.Reason})");
        }

        private void PostJsonToWebView(JsonObject json)
        {
            if (webView?.CoreWebView2 == null)
            {
                return;
            }

            try
            {
                webView.CoreWebView2.PostWebMessageAsJson(json.Stringify());
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Failed to post WebMessage: {ex.Message}");
            }
        }
    }
}
