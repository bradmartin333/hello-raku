# raku chatbot.raku --url ws://127.0.0.1:3000/chat --name raku-bot
# `--reply-delay=0.9` (seconds; debounces typing)
# `--quiet` (less stdout logging)
# `--color`, `--bg`, `--font` (theme)

use v6;

use Cro::WebSocket::Client;
use JSON::Fast;

sub generate-session-id(--> Str) {
	my $rand = (1..12).map({ ('a'..'z', '0'..'9').flat.pick }).join;
	"raku-$*PID-{DateTime.now.posix.Int}-$rand";
}

sub normalize-ws-url(Str $url --> Str) {
	# Accept http(s) URLs and map them to ws(s).
	return $url.subst(/^'http:'/, 'ws:')
			  .subst(/^'https:'/, 'wss:');
}

sub now-stamp(--> Str) {
	my $dt = DateTime.now;
	sprintf('%02d:%02d:%02d', $dt.hour, $dt.minute, $dt.second);
}

sub trim-lines(Str $s, Int $max-lines --> Str) {
	my @lines = $s.lines;
	return $s if @lines.elems <= $max-lines;
	@lines[*-$max-lines..*].join("\n");
}

sub should-respond(Str $bot-name, Str $from-user, Str $text --> Bool) {
	return False if $from-user eq $bot-name;
	return False unless $text.defined;
	my $t = $text.trim;
	return False unless $t.chars;

	# Only respond when explicitly mentioned, asked a question, or greeted.
	return True if $t ~~ m:i/ '@' $bot-name /;
	return True if $t ~~ m:i/ '\b' (hi|hello|hey) '\b' /;
	return True if $t.ends-with('?');
	False;
}

sub make-reply(Str $bot-name, Str $from-user, Str $text --> Str) {
    # TODO: Improve bot replies!
	# my $t = $text.trim;
	# if $t ~~ m:i/ '@' $bot-name / {
	# 	return "Hi $from-user — I'm $bot-name. Try asking me about Raku, Cro, or type 'help'.";
	# }
	# if $t ~~ m:i/ '\bhelp\b' / {
	# 	return "Commands: '@$bot-name …' to mention me, ask a '?' question, or say hi.";
	# }
	# if $t ~~ m:i/ '\b(raku|perl\s*6|cro)\b' / {
	# 	return "Raku tip: `say (1..10).grep(* %% 2)` filters evens. Cro is great for HTTP/WebSocket apps.";
	# }
	# if $t.ends-with('?') {
	# 	return "I might be wrong, but I'd start by simplifying the problem and checking logs/tests.";
	# }
	return "Hello $from-user!";
}

multi sub MAIN(
	Str :$url = 'ws://127.0.0.1:3000/chat',
	Str :$name = 'raku-bot',
	Str :$session-id = generate-session-id(),
	Str :$color = '#00ff00',
	Str :$bg = '#000000',
	Str :$font = 'courier',
	Num :$reply-delay = 0.9e0,
	Int :$max-lines = 20,
	Bool :$quiet = False,
) {
	my $ws-url = normalize-ws-url($url);
	my $theme = { color => $color, bg => $bg, font => $font };

	my %last-text-by-user;
	my %pending-reply;         # user => { due => Instant, text => Str }
	my %last-replied-to-text;  # user => last text we replied to

	my $bot-text = "";

	sub log($msg) {
		say $msg unless $quiet;
	}

	log("Connecting as '$name' to $ws-url");

	my $conn = await Cro::WebSocket::Client.connect($ws-url);

	sub send-json(%payload) {
		$conn.send(to-json(%payload));
	}

	sub send-bot-update(Str $new-text) {
		$bot-text = trim-lines($new-text, $max-lines);
		send-json({
			type  => 'update',
			user  => $name,
			text  => $bot-text,
			theme => $theme,
		});
	}

	send-json({
		type      => 'join',
		user      => $name,
		theme     => $theme,
		sessionId => $session-id,
	});

	send-bot-update("[$(now-stamp)] $name joined. Mention me with \@{$name}.");

	react {
		whenever $conn.messages -> $message {
			my $raw = await $message.body-text;
			my $data;
			try { $data = from-json($raw) }
			if $! || $data !~~ Associative {
				log("(ignored non-JSON message)");
				next;
			}

			my $type = $data<type> // '';
			given $type {
				when 'users' {
					for $data<users>.Array -> $entry {
						next unless $entry.defined;
						my $u = $entry ~~ Associative ?? ($entry<user> // '') !! ~$entry;
						next unless $u.chars;
						my $t = $entry ~~ Associative ?? ($entry<text> // '') !! '';
						%last-text-by-user{$u} = $t;
					}
				}
				when 'join' {
					my $u = $data<user> // '';
					log("[$(now-stamp)] join: $u") if $u && $u ne $name;
				}
				when 'leave' {
					my $u = $data<user> // '';
					log("[$(now-stamp)] leave: $u") if $u;
					%last-text-by-user{$u}:delete;
					%pending-reply{$u}:delete;
					%last-replied-to-text{$u}:delete;
				}
				when 'update' {
					my $u = $data<user> // '';
					next unless $u.chars;
					next if $u eq $name;

					my $t = $data<text> // '';
					%last-text-by-user{$u} = $t;
					%pending-reply{$u} = {
						due  => now + $reply-delay,
						text => $t,
					};
				}
				when 'error' {
					my $msg = $data<message> // 'unknown error';
					log("[$(now-stamp)] server error: $msg");
					try send-json({ type => 'leave', user => $name });
					try await $conn.close;
					done;
				}
				default {
					# ignore: user-count, fireworks, status, etc.
				}
			}
		}

		whenever Supply.interval(0.2) {
			next unless %pending-reply.elems;

			my $now = now;
			for %pending-reply.kv -> $u, %p {
				next if $now < %p<due>;
				my $latest = %p<text> // '';
				%pending-reply{$u}:delete;

				next if (%last-replied-to-text{$u} // '') eq $latest;
				next unless should-respond($name, $u, $latest);

				%last-replied-to-text{$u} = $latest;
				my $reply = make-reply($name, $u, $latest);
				my $line = "[$(now-stamp)] $u: $reply";
				send-bot-update(($bot-text.chars ?? ($bot-text ~ "\n") !! "") ~ $line);
				log("[$(now-stamp)] replied to $u");
			}
		}

		whenever signal(SIGINT) {
			log("\n[$(now-stamp)] shutting down...");
			try send-json({ type => 'leave', user => $name });
			try await $conn.close;
			done;
		}
	}
}

